// 債権会社の管理（設定タブ）。譲渡会社・譲渡先の選択肢はここで増やす。
// GET    /api/companies … 一覧
// POST   /api/companies … {名前, メモ} を追加
// PATCH  /api/companies … {id, 名前 / メモ} を変更する
// DELETE /api/companies?id=1 … 使っていなければ削除。使っていれば断る
// GET    の返事には「請求書の発行者」も入れる（計算タブの請求書に刷る名前・住所・振込先）
// PATCH  /api/companies … {請求書の発行者: {名称, 郵便番号, 住所, 電話番号, 振込先, 登録番号}}
//        で発行者を変える。テナント（この台帳を使う会社）ごとに変えられるようにするため
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, query } from './_lib.js';

// 請求書の発行者。まだ誰も変えていなければこれを出す
export const 発行者の既定 = {
  名称: 'MIAMIホールディングス', 郵便番号: '', 住所: '', 電話番号: '',
  振込先: '', 登録番号: '',
};
const 発行者の欄 = Object.keys(発行者の既定);

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
      // 並びは登録した順。名前順にすると、あとから足した会社が先頭に来て
      // 「逆に入っている」ように見えるため。
      const [rows, 発行] = await Promise.all([
        sql(`SELECT c.id, c.name, c.note,
                    (SELECT count(*)::int FROM customer x
                      WHERE (x.assignor_id = c.id OR x.assignee_id = c.id) AND x.archived=false) AS 使用数
               FROM company c ORDER BY c.id`),
        sql(`SELECT value FROM setting WHERE key='請求書の発行者'`),
      ]);

      return ok(res, {
        会社: rows.map((r) => ({
          id: r.id, 名前: r.name, メモ: r.note || '', 使用数: r.使用数 })),
        請求書の発行者: { ...発行者の既定, ...((発行[0] && 発行[0].value) || {}) },
      });
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

    // 請求書の発行者を変える（会社の行ではなく、台帳に1つだけの設定）
    if (method === 'PATCH' && b.請求書の発行者 !== undefined) {
      const 入 = b.請求書の発行者 || {};
      const 値 = {};
      for (const k of 発行者の欄) 値[k] = String(入[k] == null ? '' : 入[k]).trim();
      if (!値.名称) return bad(res, '請求書に刷る会社名を入れてください。');
      await sql(`INSERT INTO setting (key, value, updated_at, updated_by)
                 VALUES ('請求書の発行者', $1::jsonb, now(), $2)
                 ON CONFLICT (key) DO UPDATE
                   SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`,
        [JSON.stringify(値), who]);
      await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                 VALUES (NULL,$1,'設定',$2,NULL)`,
        [who, `請求書の発行者を「${値.名称}」にした`]);
      return ok(res, { done: true, 請求書の発行者: 値 });
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
      if (!set.length) return bad(res, '変更する項目がありません。');
      val.push(id);
      await sql(`UPDATE company SET ${set.join(', ')} WHERE id=$${val.length}`, val);
      await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                 VALUES (NULL,$1,'設定',$2,NULL)`,
        [who, `債権会社「${c.name}」を変更した`]);
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
      // 使われている会社は消さない。過去の契約の表示が壊れるため
      if (used) {
        return bad(res, 'この会社は削除できません。',
          `${used}件の顧客で使用中です。先にその顧客の債権譲渡会社・債権譲渡先を変えてください。`);
      }
      await sql('DELETE FROM company WHERE id=$1', [id]);
      await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                 VALUES (NULL,$1,'設定',$2,NULL)`, [who, `債権会社「${c.name}」を削除した`]);
      return ok(res, { done: true, 削除した: true });
    }

    return bad(res, '対応していない操作です。');
  } catch (e) {
    fail(res, e, 'companies');
  }
};
