// 入金履歴と、手動での入金登録。
// GET    /api/payments?件数=30&検索=... … 当日を最新として降順
// POST   /api/payments                  … 手動入金
// PATCH  /api/payments                  … 入金の内容を直す
// DELETE /api/payments?id=1             … 入金を取り消す
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, query, isoOf, today, yen, norm, allocate, unallocate, 詰め直す,
         入金種類 } from './_lib.js';

const bad = (res, msg, why) => {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(JSON.stringify(why ? { error: msg, 理由: why } : { error: msg }));
};
const METHODS = ['振込', '現金', 'その他'];
// 「3回目へ 30,000円」。ボーナスの回は通常と番号がぶつかるので賞与と付ける
const 充当の文 = (r) => r.充当
  .map((x) => `${x.種類 === 'ボーナス' ? '賞与' : ''}${x.no}回目へ ${yen(x.充てた)}円`)
  .join('、');

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
      // 入金種類。選ばれていれば、その種類の回にだけ充てる。
      // 選ばれていなければ今までどおり期日の古い順（CSVから来る入金と同じ）
      const kind = 入金種類(b.入金種類);
      if (b.入金種類 && !kind) return bad(res, '入金種類は 月額 か ボーナス を選んでください。');

      const c = (await sql('SELECT id, name FROM customer WHERE id=$1', [cid]))[0];
      if (!c) return bad(res, 'その顧客が見つかりません。');
      if (kind === 'ボーナス') {
        const ボ = await sql(
          `SELECT 1 FROM schedule WHERE customer_id=$1 AND kind='ボーナス' LIMIT 1`, [cid]);
        if (!ボ.length) return bad(res, 'この方にはボーナス払いの設定がありません。',
          '（顧客ページの「支払い条件」でボーナス月を入れてください）');
      }

      const pay = (await sql(
        `INSERT INTO payment (customer_id, paid_on, amount, method, source, memo,
                              alloc_kind, recorded_by)
         VALUES ($1,$2,$3,$4,'手動',$5,$6,$7) RETURNING id`,
        [cid, day, amount, m, memo, kind, who]))[0];
      // 充てたあと、顧客まるごと詰め直す。
      // 古い日付の入金をあとから足したときに、順番が入れ替わるため
      const r = await allocate(sql, cid, pay.id, amount, kind);
      const 余り = await 詰め直す(sql, cid);
      r.余り = 余り[pay.id] || 0;

      await sql(`INSERT INTO event (customer_id, payment_id, recorded_by, kind, text, memo)
                 VALUES ($1,$2,$3,'入金',$4,$5)`,
        [cid, pay.id, who,
         `手動で ${yen(amount)}円 を登録（${m}・${day}`
         + (kind ? `・${kind === 'ボーナス' ? 'ボーナス' : '月額'}分` : '') + '）'
         + (r.充当.length ? `：${充当の文(r)}` : '')
         + (r.余り ? `。余り ${yen(r.余り)}円`  : ''), memo]);
      return ok(res, { done: true, id: pay.id, 入金種類: kind, 充当: r.充当, 余り: r.余り });
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
      // 入金種類は、指定が無ければ登録したときのものを引き継ぐ。
      // 引き継がないと、ボーナスとして入れた入金を直した拍子に
      // 古い月額の回へ静かに移ってしまう
      let kind = b.入金種類 !== undefined ? 入金種類(b.入金種類) : (p.alloc_kind || null);
      if (b.入金種類 !== undefined && b.入金種類 && !kind) {
        return bad(res, '入金種類は 月額 か ボーナス を選んでください。');
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad(res, '日付を入れてください。');
      if (!amount || amount <= 0) return bad(res, '金額を入れてください。');
      if (cid) {
        const c = await sql('SELECT id FROM customer WHERE id=$1', [cid]);
        if (!c.length) return bad(res, 'その顧客が見つかりません。');
      }

      // 顧客を移した先にその種類の回が無ければ、種類の指定は外す。
      // 残したままだと充てる先が1つも無く、全額が余りになってしまう
      if (kind && cid) {
        const 有 = await sql(
          `SELECT 1 FROM schedule WHERE customer_id=$1 AND COALESCE(kind,'通常')=$2 LIMIT 1`,
          [cid, kind]);
        if (!有.length) kind = null;
      }

      const 種類名 = (k) => (k === 'ボーナス' ? 'ボーナス' : k === '通常' ? '月額' : '指定なし');
      const 変更 = [];
      if (isoOf(p.paid_on) !== day) 変更.push(`日付 ${isoOf(p.paid_on)}→${day}`);
      if (p.amount !== amount) 変更.push(`金額 ${yen(p.amount)}→${yen(amount)}円`);
      if (p.customer_id !== cid) 変更.push(`顧客 ${p.customer_id || '未割当'}→${cid || '未割当'}`);
      if (p.method !== m) 変更.push(`入金方法 ${p.method}→${m}`);
      if ((p.alloc_kind || null) !== (kind || null)) {
        変更.push(`入金種類 ${種類名(p.alloc_kind)}→${種類名(kind)}`);
      }

      await unallocate(sql, id);
      await sql(`UPDATE payment SET paid_on=$1, amount=$2, customer_id=$3, method=$4,
                   memo=$5, alloc_kind=$6, updated_at=now() WHERE id=$7`,
        [day, amount, cid, m, memo || null, kind, id]);
      // 直した入金だけを付け直すと、ほかの入金は前の回に残ってしまう。
      // 「1回目は未入金なのに3回目は入金済み」になるので、顧客まるごと詰め直す。
      // 顧客を移したときは、移す前の相手も詰め直す（そこに穴が空くため）
      let r = { 充当: [], 余り: amount };
      if (cid) {
        r = await allocate(sql, cid, id, amount, kind);
        const 余り = await 詰め直す(sql, cid);
        r.余り = 余り[id] || 0;
      }
      if (p.customer_id && p.customer_id !== cid) await 詰め直す(sql, p.customer_id);

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
      // 消したぶんの回だけが空いたままにならないよう、まるごと詰め直す
      if (p.customer_id) await 詰め直す(sql, p.customer_id);
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
