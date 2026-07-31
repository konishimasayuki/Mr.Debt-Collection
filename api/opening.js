// 開始時の入金実績。過去分が何回目まで済んでいるかを入れる。
// これを入れないと、載せ替えた直後は全員が1回目から未入金に見える。
//
// GET  /api/opening … 顧客ごとの、いま入っている回数と入力の目安
// POST /api/opening … {顧客id, 回数} ／ {一括:[{顧客id, 回数}, …]}
//
// 旧実装は schedule.state を書き換えるだけで入金を作っていなかったため、
// 入金済みなのに金額が0円のままだった。ここでは入金と充当まで作る。
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, isoOf, today, yen } from './_lib.js';

const bad = (res, msg, why) => {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(JSON.stringify(why ? { error: msg, 理由: why } : { error: msg }));
};

// 顧客ごとに1件だけ。入れ直すときはこの鍵で前のものを消す
const 鍵 = (id) => `opening:${id}`;

// ── 1人ぶんを入れ直す ────────────────────────
async function putOne(sql, id, 回数, who) {
  const c = (await sql('SELECT * FROM customer WHERE id=$1', [id]))[0];
  if (!c) return { 顧客id: id, error: '顧客が見つかりません。' };

  const n = Math.round(Number(回数));
  if (!Number.isFinite(n) || n < 0 || n > c.term_count) {
    return { 顧客id: id, 氏名: c.name,
      error: `回数は 0〜${c.term_count} で入れてください。` };
  }

  // 前に入れた開始時の入金を消す(充当も一緒に消える)。
  // 状態は下で入れ直すので、ここでは戻さない。
  const 前 = (await sql('SELECT id FROM payment WHERE import_key=$1', [鍵(id)]))[0];
  if (前) await sql('DELETE FROM payment WHERE id=$1', [前.id]);

  const rows = await sql(
    `SELECT id, no, due_date, planned_amount FROM schedule
      WHERE customer_id=$1 ORDER BY no`, [id]);
  const 対象 = rows.filter((s) => s.no <= n);

  // すでにCSVや手動で入っているぶんは二重に数えない
  const 既存 = {};
  if (対象.length) {
    const got = await sql(
      `SELECT schedule_id, COALESCE(sum(amount),0)::int AS n FROM allocation
        WHERE schedule_id = ANY($1::int[]) GROUP BY schedule_id`,
      [対象.map((s) => s.id)]);
    got.forEach((r) => (既存[r.schedule_id] = r.n));
  }
  const 足す = 対象
    .map((s) => ({ s, 額: Math.max(0, s.planned_amount - (既存[s.id] || 0)) }))
    .filter((x) => x.額 > 0);
  const 合計 = 足す.reduce((a, x) => a + x.額, 0);

  let paymentId = null;
  if (合計 > 0) {
    // 個々の入金日は旧台帳に無いので、最後の回の期日でまとめて記録する
    const 日 = isoOf(対象[対象.length - 1].due_date);
    const ins = await sql(
      `INSERT INTO payment
         (customer_id, paid_on, amount, method, source, memo, import_key, recorded_by)
       VALUES ($1,$2,$3,'その他','手動',$4,$5,$6) RETURNING id`,
      [id, 日, 合計,
       `開始時の入金実績（1〜${n}回目）。`
       + '個々の入金日は旧台帳に無いため、最後の回の期日でまとめています。',
       鍵(id), who]);
    paymentId = ins[0].id;
    await sql(
      `INSERT INTO allocation (payment_id, schedule_id, amount)
       SELECT $1, s, a FROM unnest($2::int[], $3::int[]) AS t(s, a)`,
      [paymentId, 足す.map((x) => x.s.id), 足す.map((x) => x.額)]);
  }

  // 状態を入れ直す。n回目までは入金済み、その先は残りの有無で決める
  const 済 = new Set(対象.map((s) => s.id));
  const 全額 = await sql(
    `SELECT s.id, s.planned_amount, COALESCE(sum(a.amount),0)::int AS n
       FROM schedule s LEFT JOIN allocation a ON a.schedule_id = s.id
      WHERE s.customer_id=$1 GROUP BY s.id, s.planned_amount`, [id]);
  for (const r of 全額) {
    const st = 済.has(r.id) || r.n >= r.planned_amount ? '入金済み'
      : r.n > 0 ? '一部入金' : '未入金';
    await sql('UPDATE schedule SET state=$1 WHERE id=$2', [st, r.id]);
  }

  await sql(`INSERT INTO event (customer_id, payment_id, recorded_by, kind, text, memo)
             VALUES ($1,$2,$3,'入金',$4,$5)`,
    [id, paymentId, who,
     `開始時の入金実績を ${n}回目まで にした`,
     合計 > 0 ? `${yen(合計)}円を1〜${n}回目に充てた` : '足す金額はなかった（すでに入っていた）']);

  return { 顧客id: id, 氏名: c.name, 入れた回数: n, 足した金額: 合計 };
}

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  const method = (req.method || 'GET').toUpperCase();

  try {
    const sql = db();

    // ── いまの状態と、入力の目安 ──────────────
    if (method === 'GET') {
      const rows = await sql(
        `SELECT c.id, c.name, c.kana, c.car, c.monthly_amount, c.term_count,
                c.pay_day, c.start_date, c.total_amount,
                (SELECT count(*)::int FROM schedule s
                  WHERE s.customer_id=c.id AND s.due_date <= current_date) AS 期日到来,
                (SELECT count(*)::int FROM schedule s
                  WHERE s.customer_id=c.id AND s.state='入金済み') AS 入金済み
           FROM customer c
          WHERE c.archived = false
          ORDER BY c.id`);

      // 開始時の入金として入れた回数（入れ直すときの初期値に使う）
      const op = await sql(
        `SELECT p.customer_id, max(s.no) AS n
           FROM payment p
           JOIN allocation a ON a.payment_id = p.id
           JOIN schedule s ON s.id = a.schedule_id
          WHERE p.import_key LIKE 'opening:%'
          GROUP BY p.customer_id`);
      const 入れた = {};
      op.forEach((r) => (入れた[r.customer_id] = Number(r.n)));

      return ok(res, {
        顧客: rows.map((c) => ({
          id: c.id, 氏名: c.name, よみ: c.kana || '', 車種: c.car || '',
          月々の金額: c.monthly_amount, 回数: c.term_count, 支払日: c.pay_day,
          開始日: isoOf(c.start_date),
          期日到来: c.期日到来,          // 入力の目安。確定値ではない
          入金済み: c.入金済み,
          開始時に入れた回数: 入れた[c.id] || 0,
        })),
        本日: today(),
        目安について: '「期日到来」は今日までに期日が来た回数です。'
          + '実際に何回目まで入っているかは通帳で確かめてください。',
      });
    }

    if (method !== 'POST') return bad(res, '対応していない操作です。');

    const b = await readBody(req);
    const who = recordedBy(req);

    // ── まとめて入れる ───────────────────
    if (Array.isArray(b['一括'])) {
      const 結果 = [];
      for (const x of b['一括']) {
        const id = Number(x.顧客id);
        if (!id) { 結果.push({ 顧客id: x.顧客id, error: '顧客が指定されていません。' }); continue; }
        結果.push(await putOne(sql, id, x.回数, who));
      }
      const 失敗 = 結果.filter((r) => r.error);
      return ok(res, {
        done: true,
        入れた人数: 結果.length - 失敗.length,
        足した金額: 結果.reduce((a, r) => a + (r.足した金額 || 0), 0),
        ...(失敗.length ? { 入らなかった分: 失敗 } : {}),
      });
    }

    // ── 1人ぶん ─────────────────────
    const id = Number(b.顧客id);
    if (!id) return bad(res, '顧客が指定されていません。');
    if (b.回数 === undefined || b.回数 === null || b.回数 === '') {
      return bad(res, '何回目まで入金が済んでいるかを入れてください。');
    }
    const r = await putOne(sql, id, b.回数, who);
    if (r.error) return bad(res, r.error);
    return ok(res, { done: true, ...r });
  } catch (e) {
    fail(res, e, 'opening');
  }
};
