// 銀行から入金明細を取ってくる。
//
// GET    /api/bank                       … 口座の一覧と、まだ確かめていない明細
// POST   /api/bank {取得:true}           … 銀行へ取りに行く（定期実行からも呼ぶ）
// POST   /api/bank {口座:{...}}          … 口座を足す・直す
// POST   /api/bank {取り込む:true,明細:[…]} … 人が残した行を入金にする
// POST   /api/bank {見送る:[id,…]}        … 入金ではないと決める
//
// 取ってきただけでは入金にしない。必ず人が確認画面を通す。
// 間違った人に入った入金は、黙って入ると誰も気づかないため。
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, query, isoOf, today, yen } from './_lib.js';
import { 照合の道具, 取込済みの鍵, プレビュー, 取り込む } from './_intake.js';
import { 取ってくる, 差し込み口の一覧 } from './_banks.js';


// 使う口座すべてから明細を取ってくる。
// 定期実行からも画面からも、同じここを通す。
async function 取りに行く(sql, who) {
  const 口座 = await sql('SELECT * FROM bank_account WHERE active = true ORDER BY id');
  if (!口座.length) return { done: true, 口座: 0, 取ってきた: 0, 結果: [] };

  const t = today();
  // 口座どうしは関係がないので同時に取りに行く。1つが失敗しても他は続ける
  const 結果 = await Promise.all(口座.map(async (a) => {
    const 前回 = a.last_ok_at ? isoOf(a.last_ok_at) : null;
    const 開始日 = 前回 ? 日をずらす(前回, -3) : 日をずらす(t, -40);
    try {
      const 行 = await 取ってくる(a, { 開始日, 終了日: t });
      let 入った = 0;
      if (行.length) {
        const 値 = [], 引数 = [];
        行.forEach((x) => {
          引数.push(a.id, x.取引通番, x.日付, x.金額,
                   x.振込人 || null, x.付番 || null, JSON.stringify(x.生 || null));
          const i = 引数.length;
          値.push(`($${i - 6},$${i - 5},$${i - 4},$${i - 3},$${i - 2},$${i - 1},$${i})`);
        });
        // 同じ取引通番はもう入っている。黙って飛ばす（取り直しは日常のため）
        const r = await sql(
          `INSERT INTO bank_txn (account_id, txn_id, paid_on, amount, payer_name, ref_no, raw)
           VALUES ${値.join(',')}
           ON CONFLICT (account_id, txn_id) DO NOTHING
           RETURNING id`, 引数);
        入った = r.length;
      }
      await sql(`UPDATE bank_account SET last_ok_at=now(), last_error=NULL, updated_at=now()
                  WHERE id=$1`, [a.id]);
      return { 口座id: a.id, 銀行名: a.bank_name, 取ってきた: 行.length, 新しく入った: 入った };
    } catch (e) {
      // 1つの口座で失敗しても、ほかの口座は取りに行く。
      // 失敗した理由は口座に残して、画面で気づけるようにする
      const 理由 = String((e && e.message) || e).slice(0, 300);
      await sql('UPDATE bank_account SET last_error=$1, updated_at=now() WHERE id=$2',
        [理由, a.id]);
      return { 口座id: a.id, 銀行名: a.bank_name, 失敗: 理由 };
    }
  }));

  const 新規 = 結果.reduce((s, x) => s + (x.新しく入った || 0), 0);
  const 失敗 = 結果.filter((x) => x.失敗);
  // 取りに行った記録は必ず残す。黙って止まっていたことに、あとから気づけるように
  await sql(`INSERT INTO event (recorded_by, kind, text) VALUES ($1,'銀行',$2)`,
    [who, `銀行から取得（口座 ${口座.length}件・新しい明細 ${新規}件`
         + (失敗.length ? `・失敗 ${失敗.length}件` : '') + '）']);
  return { done: true, 口座: 口座.length, 取ってきた: 新規, 結果 };
}

const bad = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

// 定期実行から呼ばれたか。Vercelの定期実行は合言葉を持ってくる。
// 合言葉を決めていない環境では、定期実行からは動かさない（誰でも叩けてしまうため）
function 定期実行か(req) {
  const 合言葉 = process.env.CRON_SECRET;
  if (!合言葉) return false;
  return (req.headers['authorization'] || '') === `Bearer ${合言葉}`;
}

// 何日ぶんを取りに行くか。
// 最後に取れた日の少し前から取り直す。重なっても取引通番で弾けるので害はない。
// 逆に、間が空くと取りこぼす（そちらのほうが困る）
const 日をずらす = (iso, 日数) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 日数);
  return d.toISOString().slice(0, 10);
};

// 銀行の明細を、確認画面が読める形にそろえる。
// 鍵は「銀行|口座|取引通番」。銀行が出す通番をそのまま二重取込の鍵に使う
const 鍵にする = (t) => `銀行|${t.account_id}|${t.txn_id}`;
const 明細にする = (t) => ({
  id: t.id, 鍵: 鍵にする(t),
  日付: isoOf(t.paid_on), 付番: t.ref_no || '', 金額: t.amount, 振込人: t.payer_name || '',
});

export default async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  const 定期 = 定期実行か(req);
  if (!定期 && !requireSession(req, res)) return;
  const who = 定期 ? '自動取得' : recordedBy(req);

  try {
    const sql = db();

    // ── 定期実行からの取得 ──────────────────────
    // Vercelの定期実行は GET で叩いてくる。合言葉を持っているときだけ動かす
    if (method === 'GET' && query(req)['取得'] && 定期) {
      return ok(res, await 取りに行く(sql, who));
    }

    // ── 口座と、まだ確かめていない明細 ─────────────────
    if (method === 'GET') {
      const [口座, 未確認] = await Promise.all([
        sql(`SELECT id, bank_name, branch, last4, kind, api_ref, active,
                    to_char(last_ok_at AT TIME ZONE 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') AS last_ok,
                    last_error
               FROM bank_account ORDER BY id`),
        sql(`SELECT t.*, a.bank_name FROM bank_txn t
               JOIN bank_account a ON a.id = t.account_id
              WHERE t.state = '未確認'
              ORDER BY t.paid_on, t.id`),
      ]);

      // 取ってきた明細に、顧客の当たりを付けて返す（CSVの確認画面と同じ形）
      let 明細 = [], customers = [];
      if (未確認.length) {
        const [道具, 済み] = await Promise.all([照合の道具(sql), 取込済みの鍵(sql)]);
        customers = 道具.customers;
        明細 = プレビュー(未確認.map(明細にする), { ...道具, 済み })
          .map((r, i) => ({ ...r, 明細id: 未確認[i].id, 銀行: 未確認[i].bank_name }))
          // 取り込まないと決めた振込人は、確認の表に出さない
          .filter((r) => !r.除外された);
      } else {
        customers = (await 照合の道具(sql)).customers;
      }

      return ok(res, {
        口座: 口座.map((a) => ({
          id: a.id, 銀行名: a.bank_name, 支店: a.branch || '', 下4桁: a.last4 || '',
          差し込み口: a.kind, 銀行側の識別子: a.api_ref || '', 使う: a.active,
          最後に取れた: a.last_ok || null, 最後の失敗: a.last_error || '',
        })),
        差し込み口: 差し込み口の一覧(),
        概要: {
          件数: 明細.length,
          照合できた: 明細.filter((r) => r.照合できた).length,
          照合できない: 明細.filter((r) => !r.照合できた).length,
          すでに取込済み: 明細.filter((r) => r.すでに取込済み).length,
          合計: 明細.reduce((s, r) => s + r.金額, 0),
        },
        明細,
        顧客: customers.map((c) => ({
          id: c.id, 氏名: c.name, よみ: c.kana || '',
          月額: c.monthly_amount,
          ボーナス金額: (c.bonus_months && c.bonus_months.length && c.bonus_amount)
            ? c.bonus_amount : null,
        })),
        本日: today(),
      });
    }

    if (method !== 'POST') return bad(res, 405, { error: '対応していない操作です。' });
    const b = await readBody(req);

    // ── 口座を足す・直す ───────────────────────
    if (b.口座) {
      if (定期) return bad(res, 403, { error: '定期実行からは口座を変えられません。' });
      const a = b.口座;
      const 銀行名 = String(a.銀行名 || '').trim();
      const kind = String(a.差し込み口 || '').trim();
      if (!銀行名) return bad(res, 400, { error: '銀行名を入れてください。' });
      if (!差し込み口の一覧().some((x) => x.kind === kind)) {
        return bad(res, 400, { error: 'その差し込み口はありません。',
          理由: `使えるのは ${差し込み口の一覧().map((x) => x.kind).join('・')} です` });
      }
      const 値 = [銀行名, String(a.支店 || '').trim() || null,
                  String(a.下4桁 || '').trim().slice(0, 4) || null,
                  kind, String(a.銀行側の識別子 || '').trim() || null,
                  a.使う === false ? false : true];
      if (a.id) {
        const 有 = await sql('SELECT id FROM bank_account WHERE id=$1', [Number(a.id)]);
        if (!有.length) return bad(res, 400, { error: 'その口座が見つかりません。' });
        await sql(`UPDATE bank_account SET bank_name=$1, branch=$2, last4=$3, kind=$4,
                     api_ref=$5, active=$6, updated_at=now() WHERE id=$7`,
          [...値, Number(a.id)]);
        return ok(res, { done: true, id: Number(a.id) });
      }
      const r = await sql(
        `INSERT INTO bank_account (bank_name, branch, last4, kind, api_ref, active)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, 値);
      return ok(res, { done: true, id: r[0].id });
    }

    // ── 銀行へ取りに行く ───────────────────────
    if (b.取得) return ok(res, await 取りに行く(sql, who));

    // ── 人が残した行を入金にする ──────────────────
    if (b.取り込む) {
      if (定期) return bad(res, 403, { error: '定期実行からは取り込めません。' });
      const rows = Array.isArray(b.明細) ? b.明細 : [];
      if (!rows.length) return bad(res, 400, { error: '取り込む行がありません。' });

      const r = await 取り込む(sql, who, rows, '銀行');
      // 入金になった明細に印を付ける。次からは確認画面に出ない
      const 鍵ごと = {};
      r.入れた.forEach((x) => (鍵ごと[x.鍵] = x.入金id));
      const 印を付ける = rows.filter((x) => x.明細id && 鍵ごと[x.鍵]);
      if (印を付ける.length) {
        await sql(
          `UPDATE bank_txn t SET state='取込済み', payment_id=u.p,
                  decided_at=now(), decided_by=$1
             FROM unnest($2::int[], $3::int[]) AS u(i, p)
            WHERE t.id = u.i`,
          [who, 印を付ける.map((x) => Number(x.明細id)), 印を付ける.map((x) => 鍵ごと[x.鍵])]);
      }
      return ok(res, { done: true, 取り込んだ件数: r.取込, 見送った件数: r.見送り,
                       照合できなかった件数: r.未割当, 照合できなかった明細: r.残り,
                       除いた件数: r.除いた, 余った: r.余った });
    }

    // ── 入金ではないと決める ──────────────────────
    if (b.見送る) {
      if (定期) return bad(res, 403, { error: '定期実行からは決められません。' });
      const ids = (Array.isArray(b.見送る) ? b.見送る : []).map(Number).filter(Boolean);
      if (!ids.length) return bad(res, 400, { error: 'どの明細かを指定してください。' });
      const t = await sql(
        `UPDATE bank_txn SET state='見送り', decided_at=now(), decided_by=$1
          WHERE id = ANY($2::int[]) AND state='未確認' RETURNING amount`, [who, ids]);
      if (t.length) {
        await sql(`INSERT INTO event (recorded_by, kind, text)
                   VALUES ($1,'銀行',$2)`,
          [who, `銀行の明細 ${t.length}件を見送った（合計 ${yen(
            t.reduce((s, x) => s + x.amount, 0))}円）`]);
      }
      return ok(res, { done: true, 見送った件数: t.length });
    }

    return bad(res, 400, { error: '対応していない操作です。' });
  } catch (e) {
    fail(res, e, 'bank');
  }
};
