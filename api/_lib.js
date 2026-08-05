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
// データベースは遠くにあり、問い合わせ1回ごとに往復の待ち時間がかかる。
// 回ごとに1回ずつ聞くと、48回の契約では往復が48倍になって目に見えて遅くなる。
// そのため、ここでは「回数によらず決まった数の問い合わせ」で済むように書く。

// 指定した回の状態を、いま入っている額から決め直す。何回ぶんでも1回で済ませる
async function restateMany(sql, ids) {
  if (!ids || !ids.length) return;
  await sql(
    `UPDATE schedule s SET state = CASE
          WHEN p.n <= 0                  THEN '未入金'
          WHEN p.n >= s.planned_amount   THEN '入金済み'
          ELSE '一部入金' END
       FROM (SELECT t.x AS id,
                    COALESCE((SELECT sum(a.amount) FROM allocation a
                               WHERE a.schedule_id = t.x),0)::int AS n
               FROM unnest($1::int[]) AS t(x)) p
      WHERE s.id = p.id`, [ids]);
}
// 入金を、未入金でいちばん古い回から順に充てる。
// 満額に届いた回だけ「入金済み」にし、途中は「一部入金」のまま残りを持つ。
// 予定を使い切ってもお金が余ったら、充当せずに余りとして返す(前受)。
async function allocate(sql, customerId, paymentId, amount) {
  let left = amount;
  const touched = [];
  // 各回の「すでに入っている額」も一緒に持ってくる(回ごとに聞き直さない)
  const rows = await sql(
    `SELECT s.id, s.no, s.planned_amount,
            COALESCE((SELECT sum(a.amount) FROM allocation a
                       WHERE a.schedule_id = s.id),0)::int AS paid
       FROM schedule s
      WHERE s.customer_id=$1 AND s.state <> '入金済み'
      ORDER BY s.no`, [customerId]);

  const 値 = [], 引数 = [], 済み = [], 一部 = [];
  for (const s of rows) {
    if (left <= 0) break;
    const rest = s.planned_amount - s.paid;
    if (rest <= 0) continue;
    const take = Math.min(left, rest);
    引数.push(paymentId, s.id, take);
    const i = 引数.length;
    値.push(`($${i - 2},$${i - 1},$${i})`);
    (take >= rest ? 済み : 一部).push(s.id);
    touched.push({ no: s.no, 充てた: take, 残り: rest - take });
    left -= take;
  }
  if (値.length) {
    await sql(`INSERT INTO allocation (payment_id, schedule_id, amount)
               VALUES ${値.join(',')}`, 引数);
    // 状態は2種類しかないので、まとめて2回で足りる
    if (済み.length) {
      await sql(`UPDATE schedule SET state='入金済み' WHERE id = ANY($1::int[])`, [済み]);
    }
    if (一部.length) {
      await sql(`UPDATE schedule SET state='一部入金' WHERE id = ANY($1::int[])`, [一部]);
    }
  }
  return { 充当: touched, 余り: left };
}

// 入金を取り消す。充当を消して、触っていた回の状態を戻す
async function unallocate(sql, paymentId) {
  const rows = await sql(
    `SELECT DISTINCT schedule_id FROM allocation
      WHERE payment_id=$1 AND schedule_id IS NOT NULL`, [paymentId]);
  await sql(`DELETE FROM allocation WHERE payment_id=$1`, [paymentId]);
  await restateMany(sql, rows.map((r) => r.schedule_id));
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
  readBody, query, restateMany, allocate, unallocate, summarize, makeSchedule,
};
