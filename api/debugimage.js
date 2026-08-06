// デバッグ依頼に付いた画像そのもの。<img src> から直に読む。
// GET /api/debugimage?id=N       … 原寸（長辺1600pxまで小さくしたもの）
// GET /api/debugimage?id=N&小=1  … 一覧に並べる小さい版（長辺320px）
//
// ログインしていない相手には返さない。
// 画面の写しには顧客の名前や金額が写り込むので、合鍵の要る場所に置く。
import { requireSession } from './_auth.js';
import { db, fail } from './_db.js';
import { query } from './_lib.js';

const 断る = (res, code, msg) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: msg }));
};

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  if ((req.method || 'GET').toUpperCase() !== 'GET') {
    return 断る(res, 405, '対応していない操作です。');
  }
  try {
    const q = query(req);
    const id = Number(q.id) || 0;
    if (!id) return 断る(res, 400, 'どの画像か分かりません。');

    // bytea をそのまま受け取ると、つなぎ方によって形が変わる。
    // base64 の文字列にしてもらえば、どちらでも同じに読める
    const 列 = q['小'] ? 'thumb' : 'bytes';
    const r = await db()(
      `SELECT mime, encode(${列},'base64') AS b64 FROM debug_image WHERE id=$1`, [id]);
    if (!r.length) return 断る(res, 404, 'その画像は見つかりませんでした。');

    const buf = Buffer.from(r[0].b64, 'base64');
    res.statusCode = 200;
    res.setHeader('Content-Type', r[0].mime);
    res.setHeader('Content-Length', String(buf.length));
    // 一度上げた画像は差し替わらないので、端末に長く置いてよい。
    // ただし private。共用の中継所には置かせない
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.end(buf);
  } catch (e) {
    fail(res, e, 'debugimage');
  }
};
