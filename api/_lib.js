// サーバー側の共通処理。

// ── 検索・名寄せの正規化 ───────────────────────
// 「かな」「全角カナ」「半角カナ」「半角英字」「全角英字」のどれで打っても
// 同じ人に当たるようにする。
//   NFKC で 半角カナ→全角カナ、全角英数→半角英数 が揃う。
//   そのうえで ひらがな→カタカナ、英字は小文字へ、空白と記号を落とす。
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s　]/g, '')
    .replace(/[()（）.,･・ー\-‐―－]/g, '')
    .toLowerCase();
}

// 振込人名の正規化。上に加えて法人格を落とす
function normPayer(s) {
  return norm(String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/株式会社|有限会社|\(株\)|\(有\)|カブシキガイシャ/g, '')
    .replace(/^カ\)|カ\)$/g, ''));
}

// ── 日付 ──────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const isoOf = (v) => (v == null ? null : iso(new Date(v)));
const today = () => new Date().toISOString().slice(0, 10);

// その月の末日
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// 回次kの支払期日。その月に支払日が無ければ末日にする(2月31日→2月28日)
function dueOf(y0, m0, day, k) {
  const t = y0 * 12 + (m0 - 1) + (k - 1);
  const y = Math.floor(t / 12), m = (t % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(day, lastDay(y, m)))}`;
}

const yen = (n) => Number(n || 0).toLocaleString('ja-JP');

// 支払予定を回数ぶん、1回のINSERTで作る。
// 1件ずつ入れると回数ぶん往復するので、ネットワーク越しでは目に見えて遅くなる。
async function makeSchedule(sql, customerId, y0, m0, payDay, term, monthly) {
  const vals = [], args = [];
  for (let k = 1; k <= term; k++) {
    args.push(customerId, k, dueOf(y0, m0, payDay, k), monthly);
    const i = args.length;
    vals.push(`($${i - 3},$${i - 2},$${i - 1},$${i})`);
  }
  await sql(
    `INSERT INTO schedule (customer_id, no, due_date, planned_amount)
     VALUES ${vals.join(',')} ON CONFLICT (customer_id, no) DO NOTHING`, args);
  return term;
}

// ── 本文の読み取り ─────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    // 本文の無い DELETE などは、読み取る相手がいない
    if (typeof req.on !== 'function') return resolve({});
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 2e7) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// URL のクエリ
function query(req) {
  const q = {};
  const s = String(req.url || '');
  const i = s.indexOf('?');
  if (i < 0) return q;
  new URLSearchParams(s.slice(i + 1)).forEach((v, k) => (q[k] = v));
  return q;
}

// ── 充当まわり ────────────────────────────
// その回にこれまでいくら入っているか
async function paidOn(sql, scheduleId) {
  const r = await sql(
    `SELECT COALESCE(sum(amount),0)::int AS n FROM allocation WHERE schedule_id=$1`,
    [scheduleId]);
  return r[0].n;
}

// 充当を消したあと、その回の状態を入金額から決め直す
async function restate(sql, scheduleId) {
  const s = (await sql(`SELECT planned_amount FROM schedule WHERE id=$1`, [scheduleId]))[0];
  if (!s) return;
  const n = await paidOn(sql, scheduleId);
  const state = n <= 0 ? '未入金' : (n >= s.planned_amount ? '入金済み' : '一部入金');
  await sql(`UPDATE schedule SET state=$1 WHERE id=$2`, [state, scheduleId]);
}

// 入金を、未入金でいちばん古い回から順に充てる。
// 満額に届いた回だけ「入金済み」にし、途中は「一部入金」のまま残りを持つ。
// 予定を使い切ってもお金が余ったら、充当せずに余りとして返す(前受)。
async function allocate(sql, customerId, paymentId, amount) {
  let left = amount;
  const touched = [];
  const rows = await sql(
    `SELECT id, no, planned_amount FROM schedule
      WHERE customer_id=$1 AND state <> '入金済み' ORDER BY no`, [customerId]);
  for (const s of rows) {
    if (left <= 0) break;
    const already = await paidOn(sql, s.id);
    const rest = s.planned_amount - already;
    if (rest <= 0) continue;
    const take = Math.min(left, rest);
    await sql(`INSERT INTO allocation (payment_id, schedule_id, amount) VALUES ($1,$2,$3)`,
      [paymentId, s.id, take]);
    await sql(`UPDATE schedule SET state=$1 WHERE id=$2`,
      [take >= rest ? '入金済み' : '一部入金', s.id]);
    touched.push({ no: s.no, 充てた: take, 残り: rest - take });
    left -= take;
  }
  return { 充当: touched, 余り: left };
}

// 入金を取り消す。充当を消して、触っていた回の状態を戻す
async function unallocate(sql, paymentId) {
  const rows = await sql(
    `SELECT DISTINCT schedule_id FROM allocation
      WHERE payment_id=$1 AND schedule_id IS NOT NULL`, [paymentId]);
  await sql(`DELETE FROM allocation WHERE payment_id=$1`, [paymentId]);
  for (const r of rows) await restate(sql, r.schedule_id);
}

// ── 顧客の今の状況(一覧・未入金で使う)─────────────
// 残り回数・残債・次の期日・遅れているか
function summarize(cust, rows, paidBy) {
  const term = cust.term_count;
  const done = rows.filter((s) => s.state === '入金済み').length;
  const 入金合計 = rows.reduce((a, s) => a + (paidBy[s.id] || 0), 0);
  const cur = rows.find((s) => s.state !== '入金済み') || null;
  const 期日 = cur ? isoOf(cur.due_date) : null;
  const t = today();
  return {
    残り回数: term - done,
    支払い回数: done,
    残債: Math.max(0, cust.total_amount - 入金合計),
    入金合計,
    次の期日: 期日,
    回次: cur ? cur.no : term,
    この回の請求: cur ? cur.planned_amount : 0,
    この回の入金: cur ? (paidBy[cur.id] || 0) : 0,
    この回の残り: cur ? Math.max(0, cur.planned_amount - (paidBy[cur.id] || 0)) : 0,
    遅れ: !!(期日 && 期日 < t),
    遅れ日数: 期日 && 期日 < t
      ? Math.round((new Date(t) - new Date(期日)) / 86400000) : 0,
    完済: !cur,
  };
}

export {
  norm, normPayer, pad, iso, isoOf, today, lastDay, dueOf, yen,
  readBody, query, paidOn, restate, allocate, unallocate, summarize, makeSchedule,
};
