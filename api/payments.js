// 入金履歴と、手動での入金登録。
// GET    /api/payments?件数=30&検索=... … 当日を最新として降順
// POST   /api/payments                  … 手動入金
// PATCH  /api/payments                  … 入金の内容を直す
// DELETE /api/payments?id=1             … 入金を取り消す
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, query, isoOf, today, yen, norm, allocate, unallocate } from './_lib.js';

const bad = (res, msg, why) => {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(JSON.stringify(why ? { error: msg, 理由: why } : { error: msg }));
};
const METHODS = ['振込', '現金', 'その他'];

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  const method = (req.method || 'GET').toUpperCase();

  try {
    const sql = db();

    // ── 履歴 ──────────────────────────────
    if (method === 'GET') {
      const q = query(req);
      const limit = Math.min(Math.max(Number(q['件数']) || 30, 1), 500);

      // 検索は、かな・全角カナ・半角カナ・半角英字・全角英字のどれで打っても当たる。
      // 打った文字と、氏名・よみ・振込人名の両方を同じ形にそろえてから含むかを見る。
      // そろえ方(norm)はJavaScript側にしかないので、絞り込みもこちらで行う。
      // ただし全件を持ってくると重いので、検索していないときは要る件数だけ取る。
      const key = norm(q['検索'] || '');
      const hit = (r) => !key
        || norm(r.customer_name).includes(key)
        || norm(r.customer_kana).includes(key)
        || norm(r.payer_name).includes(key);

      const [rows, 総数] = await Promise.all([
        sql(`SELECT p.id, p.paid_on, p.amount, p.method, p.source, p.ref_no, p.memo,
                    p.payer_name, p.recorded_by, p.customer_id,
                    c.name AS customer_name, c.kana AS customer_kana, c.is_test
               FROM payment p LEFT JOIN customer c ON c.id = p.customer_id
              ORDER BY p.paid_on DESC, p.id DESC
              LIMIT $1`, [key ? 5000 : limit]),
        key ? Promise.resolve(null) : sql('SELECT count(*)::int AS n FROM payment'),
      ]);

      const 当たり = rows.filter(hit);
      const list = 当たり.slice(0, limit).map((p) => ({
        id: p.id, 日付: isoOf(p.paid_on), 顧客id: p.customer_id,
        顧客名: p.customer_name || '（未割当）', テスト: !!p.is_test, 金額: p.amount,
        入金方法: p.method, 区分: p.source, 付番: p.ref_no || '',
        振込人: p.payer_name || '', メモ: p.memo || '', 記録者: p.recorded_by,
      }));
      return ok(res, { 入金: list, 件数: list.length,
        全件: 総数 ? 総数[0].n : 当たり.length, 本日: today() });
    }

    const b = await readBody(req);
    const who = recordedBy(req);

    // ── 手動入金 ────────────────────────────
    if (method === 'POST') {
      const day = String(b.日付 || '');
      const amount = Math.round(Number(b.金額) || 0);
      const cid = Number(b.顧客id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad(res, '日付を入れてください。');
      if (!cid) return bad(res, 'お名前を選んでください。');
      if (!amount || amount <= 0) return bad(res, '金額を入れてください。');
      const memo = String(b.メモ || '').trim();
      if (!memo) return bad(res, '手動で入れる理由をメモに残してください。',
        '（例：現金で受け取った、CSVに出てこない振込 など）');
      const m = METHODS.includes(b.入金方法) ? b.入金方法 : '振込';

      const c = (await sql('SELECT id, name FROM customer WHERE id=$1', [cid]))[0];
      if (!c) return bad(res, 'その顧客が見つかりません。');

      const pay = (await sql(
        `INSERT INTO payment (customer_id, paid_on, amount, method, source, memo, recorded_by)
         VALUES ($1,$2,$3,$4,'手動',$5,$6) RETURNING id`,
        [cid, day, amount, m, memo, who]))[0];
      const r = await allocate(sql, cid, pay.id, amount);

      await sql(`INSERT INTO event (customer_id, payment_id, recorded_by, kind, text, memo)
                 VALUES ($1,$2,$3,'入金',$4,$5)`,
        [cid, pay.id, who,
         `手動で ${yen(amount)}円 を登録（${m}・${day}）`
         + (r.充当.length ? `：${r.充当.map((x) => `${x.no}回目へ ${yen(x.充てた)}円`).join('、')}` : '')
         + (r.余り ? `。余り ${yen(r.余り)}円`  : ''), memo]);
      return ok(res, { done: true, id: pay.id, 充当: r.充当, 余り: r.余り });
    }

    // ── 入金を直す ───────────────────────────
    // 金額や顧客が変わると充当も変わるので、いったん外してから充て直す
    if (method === 'PATCH') {
      const id = Number(b.id);
      if (!id) return bad(res, 'どの入金かを指定してください。');
      const p = (await sql('SELECT * FROM payment WHERE id=$1', [id]))[0];
      if (!p) return bad(res, 'その入金が見つかりません。');

      const day = b.日付 !== undefined ? String(b.日付) : isoOf(p.paid_on);
      const amount = b.金額 !== undefined ? Math.round(Number(b.金額)) : p.amount;
      const cid = b.顧客id !== undefined ? (b.顧客id ? Number(b.顧客id) : null) : p.customer_id;
      const m = b.入金方法 !== undefined
        ? (METHODS.includes(b.入金方法) ? b.入金方法 : p.method) : p.method;
      const memo = b.メモ !== undefined ? String(b.メモ).trim() : (p.memo || '');

      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad(res, '日付を入れてください。');
      if (!amount || amount <= 0) return bad(res, '金額を入れてください。');
      if (cid) {
        const c = await sql('SELECT id FROM customer WHERE id=$1', [cid]);
        if (!c.length) return bad(res, 'その顧客が見つかりません。');
      }

      const 変更 = [];
      if (isoOf(p.paid_on) !== day) 変更.push(`日付 ${isoOf(p.paid_on)}→${day}`);
      if (p.amount !== amount) 変更.push(`金額 ${yen(p.amount)}→${yen(amount)}円`);
      if (p.customer_id !== cid) 変更.push(`顧客 ${p.customer_id || '未割当'}→${cid || '未割当'}`);
      if (p.method !== m) 変更.push(`入金方法 ${p.method}→${m}`);

      await unallocate(sql, id);
      await sql(`UPDATE payment SET paid_on=$1, amount=$2, customer_id=$3, method=$4,
                   memo=$5, updated_at=now() WHERE id=$6`,
        [day, amount, cid, m, memo || null, id]);
      let r = { 充当: [], 余り: amount };
      if (cid) r = await allocate(sql, cid, id, amount);

      // 顧客を移したときは、移す前の相手にも記録を残す(片方だけに残らないように)
      if (p.customer_id && p.customer_id !== cid) {
        await sql(`INSERT INTO event (customer_id, payment_id, recorded_by, kind, text, memo)
                   VALUES ($1,$2,$3,'訂正',$4,$5)`,
          [p.customer_id, id, who, `${yen(p.amount)}円 の入金を、ほかの顧客へ付け替えた`, memo || null]);
      }
      if (cid) {
        await sql(`INSERT INTO event (customer_id, payment_id, recorded_by, kind, text, memo)
                   VALUES ($1,$2,$3,'訂正',$4,$5)`,
          [cid, id, who, `入金を直した（${変更.length ? 変更.join('、') : 'メモだけ'}）`, memo || null]);
      }
      return ok(res, { done: true, 充当: r.充当, 余り: r.余り });
    }

    // ── 取り消す ────────────────────────────
    if (method === 'DELETE') {
      const id = Number(query(req).id || b.id);
      if (!id) return bad(res, 'どの入金かを指定してください。');
      const p = (await sql('SELECT * FROM payment WHERE id=$1', [id]))[0];
      if (!p) return bad(res, 'その入金が見つかりません。');
      await unallocate(sql, id);
      await sql('DELETE FROM payment WHERE id=$1', [id]);
      if (p.customer_id) {
        await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                   VALUES ($1,$2,'取消',$3,$4)`,
          [p.customer_id, who,
           `${isoOf(p.paid_on)} の入金 ${yen(p.amount)}円（${p.source}）を取り消した`,
           String(b.メモ || '').trim() || null]);
      }
      return ok(res, { done: true, 取り消した金額: p.amount });
    }

    return bad(res, '対応していない操作です。');
  } catch (e) {
    fail(res, e, 'payments');
  }
};
