// 債権会社の管理（設定タブ）。譲渡会社・譲渡先の選択肢はここで増やす。
// GET    /api/companies … 一覧
// POST   /api/companies … {名前, メモ} を追加
// PATCH  /api/companies … {id, 名前 / メモ / 使う} を直す
// DELETE /api/companies?id=1 … 使っていなければ消す。使っていれば「使わない」に倒す
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, query } from './_lib.js';

const bad = (res, msg, why) => {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(JSON.stringify(why ? { error: msg, 理由: why } : { error: msg }));
};

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  const method = (req.method || 'GET').toUpperCase();

  try {
    const sql = db();

    if (method === 'GET') {
      const rows = await sql(
        `SELECT c.id, c.name, c.note, c.active,
                (SELECT count(*)::int FROM customer x
                  WHERE (x.assignor_id = c.id OR x.assignee_id = c.id) AND x.archived=false) AS 使用数
           FROM company c ORDER BY c.active DESC, c.name`);
      return ok(res, { 会社: rows.map((r) => ({
        id: r.id, 名前: r.name, メモ: r.note || '', 使う: r.active, 使用数: r.使用数 })) });
    }

    const b = await readBody(req);
    const who = recordedBy(req);

    if (method === 'POST') {
      const name = String(b.名前 || '').trim();
      if (!name) return bad(res, '会社名を入れてください。');
      const dup = await sql('SELECT id FROM company WHERE name=$1', [name]);
      if (dup.length) return bad(res, 'その会社はすでに登録されています。', `会社番号 ${dup[0].id}`);
      const r = await sql(
        `INSERT INTO company (name, note) VALUES ($1,$2) RETURNING id`,
        [name, String(b.メモ || '').trim() || null]);
      await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                 VALUES (NULL,$1,'設定',$2,$3)`,
        [who, `債権会社「${name}」を追加した`, String(b.メモ || '').trim() || null]);
      return ok(res, { done: true, id: r[0].id, 名前: name });
    }

    if (method === 'PATCH') {
      const id = Number(b.id);
      if (!id) return bad(res, 'どの会社かを指定してください。');
      const c = (await sql('SELECT * FROM company WHERE id=$1', [id]))[0];
      if (!c) return bad(res, 'その会社が見つかりません。');
      const set = [], val = [];
      const put = (col, v) => { val.push(v); set.push(`${col}=$${val.length}`); };
      if (b.名前 !== undefined) {
        const name = String(b.名前).trim();
        if (!name) return bad(res, '会社名を入れてください。');
        const dup = await sql('SELECT id FROM company WHERE name=$1 AND id<>$2', [name, id]);
        if (dup.length) return bad(res, 'その会社名はすでに使われています。');
        put('name', name);
      }
      if (b.メモ !== undefined) put('note', String(b.メモ).trim() || null);
      if (b.使う !== undefined) put('active', !!b.使う);
      if (!set.length) return bad(res, '直す項目がありません。');
      val.push(id);
      await sql(`UPDATE company SET ${set.join(', ')} WHERE id=$${val.length}`, val);
      await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                 VALUES (NULL,$1,'設定',$2,NULL)`,
        [who, `債権会社「${c.name}」を直した`]);
      return ok(res, { done: true });
    }

    if (method === 'DELETE') {
      const id = Number(query(req).id || b.id);
      if (!id) return bad(res, 'どの会社かを指定してください。');
      const c = (await sql('SELECT * FROM company WHERE id=$1', [id]))[0];
      if (!c) return bad(res, 'その会社が見つかりません。');
      const used = (await sql(
        `SELECT count(*)::int AS n FROM customer
          WHERE (assignor_id=$1 OR assignee_id=$1) AND archived=false`, [id]))[0].n;
      if (used) {
        // 使われている会社は消さない。過去の契約の記録が壊れるため
        await sql('UPDATE company SET active=false WHERE id=$1', [id]);
        await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                   VALUES (NULL,$1,'設定',$2,NULL)`,
          [who, `債権会社「${c.name}」を「使わない」にした（${used}件で使用中のため消さない）`]);
        return ok(res, { done: true, 消した: false, 使用数: used,
          知らせ: `${used}件の顧客で使われているため、消さずに「使わない」にしました。` });
      }
      await sql('DELETE FROM company WHERE id=$1', [id]);
      await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                 VALUES (NULL,$1,'設定',$2,NULL)`, [who, `債権会社「${c.name}」を消した`]);
      return ok(res, { done: true, 消した: true });
    }

    return bad(res, '対応していない操作です。');
  } catch (e) {
    fail(res, e, 'companies');
  }
};
