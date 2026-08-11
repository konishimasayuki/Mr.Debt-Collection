// 取り込まない振込人のリスト。
//
// GET    /api/excludes            … 一覧
// POST   /api/excludes {名前, メモ} … 足す
// DELETE /api/excludes?id=…        … 外す
//
// 会社の口座間の振替や、手数料の戻しなど、お客様の入金ではないものが
// 毎月のCSVに必ず出てくる。そのたびにチェックを外すのは、外し忘れが起きる。
// 一度ここに入れておけば、CSVからでも銀行からでも、毎回自動で外れる。
//
// 名前は normPayer でそろえてから覚える。銀行の明細は半角カナで来たり
// 全角で来たりするので、見た目が違っても同じ名前として当てるため。
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, query, normPayer } from './_lib.js';

const bad = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  const who = recordedBy(req);
  const m = (req.method || 'GET').toUpperCase();

  try {
    const sql = db();

    if (m === 'POST') {
      const b = await readBody(req);
      const 生 = String(b.名前 || '').trim();
      if (!生) return bad(res, 400, { error: '振込人名を入れてください。' });
      const n = normPayer(生);
      if (!n) return bad(res, 400, { error: 'その名前は覚えられません。' });
      await sql(
        `INSERT INTO payer_exclude (normalized_name, raw_name, memo, created_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (normalized_name) DO UPDATE SET raw_name=EXCLUDED.raw_name,
                                                    memo=EXCLUDED.memo`,
        [n, 生, String(b.メモ || '').trim() || null, who]);
      return ok(res, { done: true });
    }

    if (m === 'DELETE') {
      const id = Number(query(req).id) || 0;
      if (!id) return bad(res, 400, { error: 'どれを外すかを指定してください。' });
      await sql('DELETE FROM payer_exclude WHERE id=$1', [id]);
      return ok(res, { done: true });
    }

    if (m !== 'GET') return bad(res, 405, { error: '対応していない操作です。' });

    const rows = await sql(
      `SELECT id, raw_name, memo,
              to_char(created_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS on
         FROM payer_exclude ORDER BY raw_name`);
    return ok(res, {
      除外: rows.map((r) => ({ id: r.id, 名前: r.raw_name, メモ: r.memo || '', 入れた日: r.on })),
    });
  } catch (e) {
    fail(res, e, 'excludes');
  }
};
