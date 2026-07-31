// CSVの取り込み。
// POST /api/import {text}                  … 読み取ってプレビューを返す（保存しない）
// POST /api/import {実行:true, 明細:[...]}  … 画面で残した行だけを保存する
// POST /api/import {割当:{...}}             … 照合できなかった1件を顧客に割り当てる
//
// 重複は 日付+付番+金額 で見る。ファイルの中の重複と、すでに取り込み済みの両方に印を付ける。
// 印を付けるだけで勝手には落とさない（同じ日に同じ額が2件、は実際に起きるため）。
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, isoOf, yen, norm, normPayer, allocate } from './_lib.js';
import { parseCsv } from './_csv.js';

const bad = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

// 重複判定の鍵。日付+付番+金額
const dupKey = (r) => `${r.日付}|${String(r.付番 || '').trim()}|${r.金額}`;
// 二重取込を弾く鍵。付番が無い/重複しうるので、同一内の連番も混ぜる
const importKey = (r, seq) => `${r.日付}|${String(r.付番 || '').trim()}|${r.金額}|${normPayer(r.振込人)}|${seq}`;

// 振込人名から顧客を当てる
function matcher(aliases, customers) {
  const byAlias = {};
  aliases.forEach((a) => (byAlias[a.normalized_name] = a.customer_id));
  const byKana = {};
  customers.forEach((c) => {
    const k = normPayer(c.kana || '');
    if (k) (byKana[k] = byKana[k] || []).push(c);
    const n = normPayer(c.name || '');
    if (n && n !== k) (byKana[n] = byKana[n] || []).push(c);
  });
  const keys = Object.keys(byKana).filter((k) => k.length >= 2)
    .sort((a, b) => b.length - a.length);      // 長い読みを先に見る

  return (payer, amount) => {
    const k = normPayer(payer);
    if (!k) return { id: null, 理由: '振込人名がありません' };
    if (byAlias[k]) return { id: byAlias[k], 理由: '前に紐付けたお名前' };
    let cand = byKana[k], why = 'お名前が一致';
    if (!cand) {
      const hit = keys.find((key) => k.startsWith(key));
      if (hit) { cand = byKana[hit]; why = `苗字の読み「${hit}」で一致`; }
    }
    if (!cand || !cand.length) return { id: null, 理由: '該当する顧客が見つかりません' };
    if (cand.length === 1) return { id: cand[0].id, 理由: why };
    const fit = cand.filter((c) => c.monthly_amount === amount);
    if (fit.length === 1) return { id: fit[0].id, 理由: `${why}。同姓のため金額で判断` };
    return { id: null, 理由: '同じお名前が複数います。確かめてください' };
  };
}

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  if ((req.method || '').toUpperCase() !== 'POST') {
    return bad(res, 405, { error: 'POSTで送ってください。' });
  }
  const who = recordedBy(req);

  try {
    const sql = db();
    const b = await readBody(req);

    const customers = await sql(
      `SELECT id, name, kana, monthly_amount FROM customer WHERE archived=false ORDER BY id`);
    const aliases = await sql(`SELECT normalized_name, customer_id FROM payer_alias`);
    const match = matcher(aliases, customers);
    const nameOf = (id) => (customers.find((c) => c.id === id) || {}).name || null;

    // ── 照合できなかった1件を、人が選んだ顧客に割り当てる ──────
    if (b.割当) {
      const a = b.割当;
      const cid = Number(a.顧客id);
      const amount = Math.round(Number(a.金額) || 0);
      if (!cid) return bad(res, 400, { error: 'どの顧客かを選んでください。' });
      if (!amount || amount <= 0) return bad(res, 400, { error: '金額が読めません。' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.日付 || ''))) {
        return bad(res, 400, { error: '日付が読めません。' });
      }
      const c = (await sql('SELECT id, name FROM customer WHERE id=$1', [cid]))[0];
      if (!c) return bad(res, 400, { error: 'その顧客が見つかりません。' });

      // すでに入っている入金の付け替えか、新しく入れるか
      let pid = Number(a.入金id) || null;
      if (pid) {
        const p = (await sql('SELECT * FROM payment WHERE id=$1', [pid]))[0];
        if (!p) return bad(res, 400, { error: 'その入金が見つかりません。' });
        await sql('UPDATE payment SET customer_id=$1, updated_at=now() WHERE id=$2', [cid, pid]);
      } else {
        const key = String(a.鍵 || importKey(a, 1));
        const dup = await sql('SELECT id FROM payment WHERE import_key=$1', [key]);
        if (dup.length) return ok(res, { done: true, 保存した: false, 理由: 'すでに取り込み済みです' });
        pid = (await sql(
          `INSERT INTO payment (customer_id, paid_on, amount, method, source, ref_no,
                                payer_name, import_key, recorded_by)
           VALUES ($1,$2,$3,'振込','CSV',$4,$5,$6,$7) RETURNING id`,
          [cid, a.日付, amount, String(a.付番 || '') || null,
           String(a.振込人 || '') || null, key, who]))[0].id;
      }
      const r = await allocate(sql, cid, pid, amount);
      await sql(`INSERT INTO event (customer_id, payment_id, recorded_by, kind, text, memo)
                 VALUES ($1,$2,$3,'入金',$4,$5)`,
        [cid, pid, who, `${yen(amount)}円 を人が選んで割り当て（振込人：${a.振込人 || '—'}）`, null]);
      if (a.振込人) {
        await sql(`INSERT INTO payer_alias (normalized_name, customer_id, created_by)
                   VALUES ($1,$2,$3) ON CONFLICT (normalized_name) DO NOTHING`,
          [normPayer(a.振込人), cid, who]);
      }
      return ok(res, { done: true, 保存した: true, 顧客: c.name, 充当: r.充当, 余り: r.余り });
    }

    // ── 保存 ─────────────────────────────
    if (b.実行) {
      const rows = Array.isArray(b.明細) ? b.明細 : [];
      if (!rows.length) return bad(res, 400, { error: '取り込む行がありません。' });

      let 取込 = 0, 見送り = 0, 未割当 = 0;
      const 残り = [];
      const seen = {};
      for (const r of rows) {
        const amount = Math.round(Number(r.金額) || 0);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.日付 || '')) || !amount || amount <= 0) {
          見送り++; continue;
        }
        const base = dupKey(r);
        seen[base] = (seen[base] || 0) + 1;
        const key = String(r.鍵 || importKey(r, seen[base]));

        const dup = await sql('SELECT id FROM payment WHERE import_key=$1', [key]);
        if (dup.length) { 見送り++; continue; }

        const cid = r.顧客id ? Number(r.顧客id) : match(r.振込人, amount).id;
        const pid = (await sql(
          `INSERT INTO payment (customer_id, paid_on, amount, method, source, ref_no,
                                payer_name, import_key, recorded_by)
           VALUES ($1,$2,$3,'振込','CSV',$4,$5,$6,$7) RETURNING id`,
          [cid || null, r.日付, amount, String(r.付番 || '') || null,
           String(r.振込人 || '') || null, key, who]))[0].id;

        if (cid) {
          const al = await allocate(sql, cid, pid, amount);
          await sql(`INSERT INTO event (customer_id, payment_id, recorded_by, kind, text, memo)
                     VALUES ($1,$2,$3,'入金',$4,NULL)`,
            [cid, pid, who,
             `CSVから ${yen(amount)}円 を取り込み（${r.日付}・振込人：${r.振込人 || '—'}）`
             + (al.余り ? `。余り ${yen(al.余り)}円` : '')]);
          await sql(`INSERT INTO payer_alias (normalized_name, customer_id, created_by)
                     VALUES ($1,$2,$3) ON CONFLICT (normalized_name) DO NOTHING`,
            [normPayer(r.振込人), cid, who]);
          取込++;
        } else {
          未割当++;
          残り.push({ 入金id: pid, 日付: r.日付, 付番: r.付番 || '', 金額: amount,
                      振込人: r.振込人 || '', 理由: match(r.振込人, amount).理由 });
        }
      }
      return ok(res, { done: true, 取り込んだ件数: 取込, 見送った件数: 見送り,
                       照合できなかった件数: 未割当, 照合できなかった明細: 残り });
    }

    // ── プレビュー（読み取るだけ。保存しない）──────────────
    if (!b.text) return bad(res, 400, { error: 'ファイルの中身がありません。' });
    let parsed;
    try { parsed = parseCsv(b.text); }
    catch (e) { return bad(res, 400, { error: 'CSVとして読み取れません。', 理由: e.message }); }

    // すでに取り込んである明細（日付+付番+金額 で見る）
    const done = await sql(
      `SELECT paid_on, ref_no, amount FROM payment WHERE source='CSV'`);
    const already = new Set(done.map((d) =>
      `${isoOf(d.paid_on)}|${String(d.ref_no || '').trim()}|${d.amount}`));

    // ファイルの中の重複
    const count = {};
    parsed.明細.forEach((r) => { const k = dupKey(r); count[k] = (count[k] || 0) + 1; });

    const seq = {};
    const 明細 = parsed.明細.map((r, i) => {
      const k = dupKey(r);
      seq[k] = (seq[k] || 0) + 1;
      const m = match(r.振込人, r.金額);
      return {
        行: i + 1, 鍵: importKey(r, seq[k]),
        日付: r.日付, 付番: r.付番 || '', 金額: r.金額, 振込人: r.振込人 || '',
        顧客id: m.id, 顧客名: nameOf(m.id), 判断: m.理由,
        照合できた: !!m.id,
        ファイル内で重複: count[k] > 1,
        すでに取込済み: already.has(k),
      };
    });

    const sum = 明細.reduce((s, r) => s + r.金額, 0);
    return ok(res, {
      形式: parsed.形式,
      概要: {
        件数: 明細.length,
        照合できた: 明細.filter((r) => r.照合できた).length,
        照合できない: 明細.filter((r) => !r.照合できた).length,
        ファイル内で重複: 明細.filter((r) => r.ファイル内で重複).length,
        すでに取込済み: 明細.filter((r) => r.すでに取込済み).length,
        合計: sum,
        ファイル検算: parsed.トレーラ ? parsed.トレーラ.合計 === sum : null,
      },
      明細,
      顧客: customers.map((c) => ({ id: c.id, 氏名: c.name, よみ: c.kana || '' })),
    });
  } catch (e) {
    fail(res, e, 'import');
  }
};
