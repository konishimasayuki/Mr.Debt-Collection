// デバッグ依頼。使っていて困ったことを、画面からそのまま出せるようにする。
// GET    /api/debug        … 依頼の一覧（画像そのものは含めない）
// GET    /api/debug?id=N   … 1件（本文・画像・返信のすべて）
// POST   /api/debug        … 新しい依頼 {題名, 本文, 画像:[…]}
// POST   /api/debug        … 返信       {依頼:N, 本文, 画像:[…]}
// PATCH  /api/debug        … 状態を変える {id, 状態}
// DELETE /api/debug?id=N   … 依頼を消す（返信と画像も一緒に消える）
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, query } from './_lib.js';
import { notifyKonichat } from './_konichat.js';

const bad = (res, msg, why) => {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(JSON.stringify(why ? { error: msg, 理由: why } : { error: msg }));
};

const 状態一覧 = ['未対応', '対応中', '直した'];

// 画像の受け入れ。Vercel は1回の送信を 4.5MB までしか通さないので、
// 画面側で小さくしたうえで、ここでも念のため止める。
const 上限枚数 = 8;
const 一枚の上限 = 1.6 * 1024 * 1024;   // base64 にしたあとの大きさ
const 全体の上限 = 3.5 * 1024 * 1024;
const 許す種類 = new Set(['image/jpeg', 'image/png', 'image/webp']);

// 日時は日本時間の文字どおりで返す。
// 端末ごとの時計の設定に振り回されないようにする。
const 日時 = (列) => `to_char(${列} AT TIME ZONE 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI')`;

// 送られてきた画像を確かめる。おかしければ理由を返す
function 画像を確かめる(画像) {
  const 並び = Array.isArray(画像) ? 画像 : [];
  if (!並び.length) return { 画像: [] };
  if (並び.length > 上限枚数) {
    return { error: `画像は${上限枚数}枚までです。`, 理由: `${並び.length}枚 送られました` };
  }
  let 合計 = 0;
  const 出来上がり = [];
  for (const g of 並び) {
    const 種類 = String((g && g.種類) || '');
    const データ = String((g && g.データ) || '');
    const 小 = String((g && g.小) || '') || データ;
    if (!許す種類.has(種類)) {
      return { error: '画像として読めないものが混ざっています。', 理由: `種類: ${種類 || '不明'}` };
    }
    if (!データ) return { error: '画像の中身が空です。' };
    if (データ.length > 一枚の上限) {
      return { error: '画像が大きすぎます。', 理由: '1枚あたり およそ1MBまでです' };
    }
    合計 += データ.length + 小.length;
    if (合計 > 全体の上限) {
      return { error: '画像の合計が大きすぎます。', 理由: '枚数を減らして送ってください' };
    }
    出来上がり.push({ 種類, データ, 小, 名前: String((g && g.名前) || '').slice(0, 120) || null });
  }
  return { 画像: 出来上がり };
}

// まとめて1回で入れる。枚数ぶん往復すると、そのぶん待たされる
async function 画像を入れる(sql, 依頼id, 返信id, 画像) {
  if (!画像.length) return;
  const 値 = [], 引数 = [];
  for (const g of 画像) {
    引数.push(依頼id, 返信id, g.種類, g.名前, g.データ, g.小);
    const n = 引数.length;
    値.push(`($${n - 5},$${n - 4},$${n - 3},$${n - 2},`
      + `decode($${n - 1},'base64'),decode($${n},'base64'))`);
  }
  await sql(`INSERT INTO debug_image (ticket_id, message_id, mime, name, bytes, thumb)
             VALUES ${値.join(',')}`, 引数);
}

const 画像の形 = (r) => ({ id: r.id, 名前: r.name || '', 種類: r.mime, 大きさ: Number(r.size) || 0 });

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  const method = (req.method || 'GET').toUpperCase();

  try {
    const sql = db();
    const q = query(req);

    if (method === 'GET') {
      const id = Number(q.id) || 0;

      // ── 1件ぶん（本文・画像・返信）──────────────
      if (id) {
        // 3つは互いに関係がないので同時に投げる。順に待つと待ち時間が3つぶんになる
        const [依頼, 返信, 画像] = await Promise.all([
          sql(`SELECT id, title, body, state, created_by, ${日時('created_at')} AS at
                 FROM debug_ticket WHERE id=$1`, [id]),
          sql(`SELECT id, body, created_by, ${日時('created_at')} AS at
                 FROM debug_message WHERE ticket_id=$1 ORDER BY id`, [id]),
          sql(`SELECT id, message_id, mime, name, octet_length(bytes) AS size
                 FROM debug_image WHERE ticket_id=$1 ORDER BY id`, [id]),
        ]);
        if (!依頼.length) return bad(res, 'その依頼は見つかりませんでした。');
        const t = 依頼[0];
        const 返信ごと = {};
        画像.forEach((g) => {
          const 鍵 = g.message_id == null ? 0 : g.message_id;
          (返信ごと[鍵] = 返信ごと[鍵] || []).push(画像の形(g));
        });
        return ok(res, {
          依頼: {
            id: t.id, 題名: t.title, 本文: t.body || '', 状態: t.state,
            投稿者: t.created_by, 日時: t.at, 画像: 返信ごと[0] || [],
            返信: 返信.map((m) => ({
              id: m.id, 本文: m.body || '', 投稿者: m.created_by, 日時: m.at,
              画像: 返信ごと[m.id] || [],
            })),
          },
        });
      }

      // ── 一覧 ────────────────────────
      // 画像そのものは持ってこない。一覧に原寸を並べると重い
      const [依頼, 画像, 返信数] = await Promise.all([
        sql(`SELECT id, title, body, state, created_by, ${日時('created_at')} AS at
               FROM debug_ticket ORDER BY id DESC`),
        sql(`SELECT id, ticket_id, mime, name, octet_length(bytes) AS size
               FROM debug_image WHERE message_id IS NULL ORDER BY id`),
        sql(`SELECT ticket_id, count(*)::int AS n FROM debug_message GROUP BY ticket_id`),
      ]);
      const 画像ごと = {}, 数ごと = {};
      画像.forEach((g) => (画像ごと[g.ticket_id] = 画像ごと[g.ticket_id] || []).push(画像の形(g)));
      返信数.forEach((r) => (数ごと[r.ticket_id] = r.n));
      return ok(res, {
        依頼: 依頼.map((t) => ({
          id: t.id, 題名: t.title, 本文: t.body || '', 状態: t.state,
          投稿者: t.created_by, 日時: t.at,
          画像: 画像ごと[t.id] || [], 返信数: 数ごと[t.id] || 0,
        })),
      });
    }

    if (method === 'POST') {
      const who = recordedBy(req);
      const b = await readBody(req);
      const 検査 = 画像を確かめる(b.画像);
      if (検査.error) return bad(res, 検査.error, 検査.理由);

      // ── 返信 ────────────────────────
      if (b.依頼) {
        const 依頼id = Number(b.依頼) || 0;
        const 本文 = String(b.本文 || '').trim();
        if (!本文 && !検査.画像.length) {
          return bad(res, '返信が空です。', 'メッセージか画像のどちらかを入れてください');
        }
        const ある = await sql('SELECT id, title FROM debug_ticket WHERE id=$1', [依頼id]);
        if (!ある.length) return bad(res, 'その依頼は見つかりませんでした。');

        const ins = await sql(
          `INSERT INTO debug_message (ticket_id, body, created_by) VALUES ($1,$2,$3) RETURNING id`,
          [依頼id, 本文 || null, who]);
        await 画像を入れる(sql, 依頼id, ins[0].id, 検査.画像);
        await sql('UPDATE debug_ticket SET updated_at=now() WHERE id=$1', [依頼id]);
        // スーパーコニチャットの「デバック依頼」チャンネルへ転送（テキストのみ・失敗しても投稿は成功扱い）
        await notifyKonichat({ kind: 'reply', threadTitle: ある[0].title, body: 本文, authorName: who });
        return ok(res, { done: true, 依頼: 依頼id, id: ins[0].id });
      }

      // ── 新しい依頼 ───────────────────
      const 題名 = String(b.題名 || '').trim();
      const 本文 = String(b.本文 || '').trim();
      if (!題名) return bad(res, 'タイトルを入れてください。');
      if (題名.length > 200) return bad(res, 'タイトルが長すぎます。', '200文字までにしてください');

      const ins = await sql(
        `INSERT INTO debug_ticket (title, body, created_by) VALUES ($1,$2,$3) RETURNING id`,
        [題名, 本文 || null, who]);
      await 画像を入れる(sql, ins[0].id, null, 検査.画像);
      // スーパーコニチャットの「デバック依頼」チャンネルへ転送（テキストのみ・失敗しても投稿は成功扱い）
      await notifyKonichat({ kind: 'thread', title: 題名, body: 本文, authorName: who });
      return ok(res, { done: true, id: ins[0].id, 題名 });
    }

    if (method === 'PATCH') {
      const b = await readBody(req);
      const id = Number(b.id) || 0;
      const 状態 = String(b.状態 || '');
      if (!id) return bad(res, 'どの依頼か分かりません。');
      if (!状態一覧.includes(状態)) {
        return bad(res, '知らない状態です。', 状態一覧.join(' / ') + ' のどれかにしてください');
      }
      const done = await sql(
        `UPDATE debug_ticket SET state=$1, updated_at=now() WHERE id=$2 RETURNING id`, [状態, id]);
      if (!done.length) return bad(res, 'その依頼は見つかりませんでした。');
      return ok(res, { done: true, id, 状態 });
    }

    if (method === 'DELETE') {
      const id = Number(q.id) || 0;
      if (!id) return bad(res, 'どの依頼か分かりません。');
      // 返信と画像は ON DELETE CASCADE で一緒に消える
      const done = await sql('DELETE FROM debug_ticket WHERE id=$1 RETURNING title', [id]);
      if (!done.length) return bad(res, 'その依頼は見つかりませんでした。');
      return ok(res, { done: true, 題名: done[0].title });
    }

    return bad(res, '対応していない操作です。');
  } catch (e) {
    fail(res, e, 'debug');
  }
};
