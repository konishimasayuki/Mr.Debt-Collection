// 銀行明細(全銀協規定形式)の取り込み。
// POST /api/import {text}            … 解析だけして結果を返す(まだ保存しない)
// POST /api/import {text, 実行:true}  … 名前が一致した分だけ取り込む
// POST /api/import {割当:{...}}       … 分からなかった1件を、人が選んだお客さんの入金にする
//
// 二重取込はデータベースの一意制約で弾く(照会番号は重複しうるため、
// 日付+金額+依頼人名+連番の鍵を使う)。判定は人に見せない(規約)。
const { requireSession, recordedBy } = require('./_auth');
const { db, fail, ok } = require('./_db');
const { parseZengin, normKana } = require('./_zengin');

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
const yen = (n) => Number(n).toLocaleString('ja-JP');
const bad = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

// 1件を保存する。自動で当たった分も、人が選んだ分も、ここを通る。
// すでに同じ明細が入っていれば false(一意制約に任せる)。
async function commitOne(sql, r, who) {
  let pay;
  try {
    pay = (await sql(
      `INSERT INTO payment (contract_id, paid_on, amount, method, recorded_by, source, import_key, payer_name)
       VALUES ($1,$2,$3,'振込',$4,'全銀CSV',$5,$6) RETURNING id`,
      [r.contract_id, r.iso, r.amount, who, r.import_key, r.payer]))[0];
  } catch (e) {
    if (e && String(e.message).includes('payment_import_key')) return false;
    throw e;
  }

  const target = (await sql(
    `SELECT id, no, planned_amount FROM schedule
      WHERE contract_id=$1 AND state <> '入金済み' ORDER BY no LIMIT 1`, [r.contract_id]))[0];

  // 元本75:手数料25で按分(手入力の記録と同じ定率)
  const moto = Math.round(r.amount * 0.75);
  await sql(`INSERT INTO allocation (payment_id, schedule_id, amount, kind)
             VALUES ($1,$2,$3,'元本'), ($1,$2,$4,'手数料')`,
    [pay.id, target ? target.id : null, moto, r.amount - moto]);

  if (target) {
    await sql(`UPDATE schedule SET state='入金済み' WHERE id=$1`, [target.id]);
    const d = r.amount - target.planned_amount;
    if (d !== 0) await sql(
      `UPDATE contract SET balance_diff = balance_diff + $1, updated_at=now() WHERE id=$2`,
      [d, r.contract_id]);
  }
  await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
             VALUES ($1,$2,$3,'入金',$4,$5)`,
    [r.contract_id, target ? target.no : null, who,
     `銀行明細から ${yen(r.amount)}円 を取り込み`,
     `振込人:${r.payer}${r.手動 ? '（人が選んで割り当て）' : ''}`]);

  // 名寄せ辞書に覚える(次回から自動で当たる)
  await sql(`INSERT INTO payer_alias (normalized_name, contract_id, created_by)
             VALUES ($1,$2,$3) ON CONFLICT (normalized_name) DO NOTHING`,
    [normKana(r.payer), r.contract_id, who]);
  return true;
}

module.exports = async (req, res) => {
  if (!requireSession(req, res)) return;
  if ((req.method || '').toUpperCase() !== 'POST') {
    return bad(res, 405, { error: 'POSTで送ってください。' });
  }
  const who = recordedBy(req);

  try {
    const sql = db();
    const b = await readBody(req);

    // ── 分からなかった1件を、人が選んだお客さんの入金にする ────────
    if (b.割当) {
      const a = b.割当;
      const cid = Number(a.contract_id);
      const amount = Number(a.amount);
      if (!cid) return bad(res, 400, { error: 'どなたの入金かを選んでください。' });
      if (!amount || amount <= 0) return bad(res, 400, { error: '金額が読めません。' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.iso || ''))) return bad(res, 400, { error: '日付が読めません。' });
      const c = (await sql('SELECT id, name FROM contract WHERE id=$1', [cid]))[0];
      if (!c) return bad(res, 400, { error: 'そのお客さんが見つかりません。' });
      const saved = await commitOne(sql, {
        contract_id: cid, iso: a.iso, amount, payer: String(a.payer || ''),
        import_key: String(a.import_key || `${a.iso}|${amount}|${normKana(a.payer)}|1`),
        手動: true,
      }, who);
      return ok(res, { done: true, 保存した: saved, お客さん: c.name });
    }

    if (!b.text) return bad(res, 400, { error: 'ファイルの中身がありません。' });

    // 読めないファイルは「こちらの故障」ではないので、理由をそのまま返す
    let deposits, trailer;
    try { ({ deposits, trailer } = parseZengin(b.text)); }
    catch (e) { return bad(res, 400, { error: '銀行のファイルとして読めません。', 理由: e.message }); }

    // 名寄せ辞書と契約の読みで突き合わせる
    const aliases = await sql(`SELECT normalized_name, contract_id FROM payer_alias`);
    const byAlias = {};
    aliases.forEach((a) => (byAlias[a.normalized_name] = a.contract_id));
    const contracts = await sql(`SELECT id, name, kana, monthly_amount FROM contract`);
    const byKana = {};
    contracts.forEach((c) => {
      const k = normKana(c.kana || '');
      if (k) (byKana[k] = byKana[k] || []).push(c);
    });

    // すでに取り込んだ明細
    const keys = deposits.map((d) => d.import_key);
    const done = keys.length
      ? (await sql(`SELECT import_key FROM payment WHERE import_key = ANY($1)`, [keys]))
          .map((r) => r.import_key)
      : [];
    const already = new Set(done);

    const rows = deposits.map((d) => {
      const k = normKana(d.payer);
      let contract_id = byAlias[k] || null, why = contract_id ? '前に紐付けたお名前' : '';
      if (!contract_id && byKana[k]) {
        const cand = byKana[k];
        if (cand.length === 1) { contract_id = cand[0].id; why = 'お名前が一致'; }
        else {
          // 同姓が実在する。金額で判断し、決めきれないものは人に回す
          const fit = cand.filter((c) => c.monthly_amount === d.amount);
          if (fit.length === 1) { contract_id = fit[0].id; why = '同姓が複数。金額で判断'; }
          else why = '同じお名前が複数。確かめてください';
        }
      }
      const c = contract_id ? contracts.find((x) => x.id === contract_id) : null;
      return { ...d, contract_id, name: c ? c.name : null, why,
               取込済み: already.has(d.import_key),
               auto: !!contract_id && why !== '同じお名前が複数。確かめてください' };
    });

    const sum = rows.reduce((s, r) => s + r.amount, 0);
    const summary = {
      入金の件数: rows.length,
      お名前が一致: rows.filter((r) => r.auto && !r.取込済み).length,
      確かめる必要: rows.filter((r) => !r.auto && !r.取込済み).length,
      すでに取込済み: rows.filter((r) => r.取込済み).length,
      合計: sum,
      ファイル検算: trailer ? (trailer.inTotal === sum) : null,
    };

    // 画面へ渡す形。分からなかった分は、人が選べるように鍵も一緒に返す
    const 明細 = rows.map((r) => ({
      鍵: r.import_key, 日付: r.iso, 金額: r.amount, 振込人: r.payer,
      お客さん番号: r.contract_id, お客さん: r.name, 判断: r.why,
      取込済み: r.取込済み, 自動: r.auto,
    }));

    // 確認だけ(まだ保存しない)
    if (!b.実行) return ok(res, { 確認: true, 概要: summary, 明細 });

    // 取り込み。名前が決まった分だけ。二重取込は一意制約が弾く
    let saved = 0, skipped = 0;
    for (const r of rows) {
      if (!r.auto || !r.contract_id || r.取込済み) { skipped++; continue; }
      if (await commitOne(sql, r, who)) saved++; else skipped++;
    }
    return ok(res, { done: true, 取り込んだ件数: saved, 見送った件数: skipped,
      概要: summary, 残り: 明細.filter((m) => !m.自動 && !m.取込済み) });
  } catch (e) {
    fail(res, e, 'import');
  }
};
