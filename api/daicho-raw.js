// 口座台帳（kouza-daicho）へ、取り込んだCSVの原本を渡す口。読むだけ。
//
// GET /api/daicho-raw        … 原本の一覧 {原本:[{id, 名前, 大きさ, 指紋, 保存日時}]}
// GET /api/daicho-raw?id=N   … その原本のバイトそのまま（見出し x-sha256 に指紋）
//
// 口座台帳は、筑邦銀行の入金と出金の流れを1本の帳簿で見せる。
// この台帳は入金しか取らず出金を捨てるので、加工した結果ではなく原本を渡し、
// 台帳の側で読み直してもらう。
//
// 決めごと：
// - 画面のログイン（クッキー）は使わない。台帳のサーバーから呼ばれるため。
//   代わりに見出し x-daicho-key が環境変数 DAICHO_READ_KEY と一致しないと断る
// - DAICHO_READ_KEY が入っていないときは、だれにも返さない（入れ忘れても開きっぱなしにしない）
// - 読むだけ。GET 以外は断る。ほかの表には触れない
// - 合鍵は前後の空白・改行を取り除いてから比べる（貼り付けで末尾に改行が付くことがあるため）
import { createHash, timingSafeEqual } from 'node:crypto';
import { db, fail, ok } from './_db.js';
import { query } from './_lib.js';

const 断る = (res, code, error) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error }));
};

// 長さの違いや中身で、比べる時間が変わらないようにする（指紋どうしを比べる）
function 合鍵が合う(req) {
  const want = String(process.env.DAICHO_READ_KEY || '').trim();
  const got = String((req.headers || {})['x-daicho-key'] || '').trim();
  if (!want || !got) return false;
  const a = createHash('sha256').update(want).digest();
  const b = createHash('sha256').update(got).digest();
  return timingSafeEqual(a, b);
}

export default async (req, res) => {
  if ((req.method || '').toUpperCase() !== 'GET') {
    return 断る(res, 405, '読むだけの口です。GETで呼んでください。');
  }
  if (!String(process.env.DAICHO_READ_KEY || '').trim()) {
    return 断る(res, 503, '合鍵が入っていません（DAICHO_READ_KEY）。');
  }
  if (!合鍵が合う(req)) {
    return 断る(res, 401, '合鍵が違います。');
  }

  try {
    const sql = db();
    const raw = query(req).id;

    // ── 原本そのもの ──────────────────────────
    if (raw !== undefined) {
      const id = Number(raw);
      if (!Number.isInteger(id) || id <= 0) return 断る(res, 400, 'id が読めません。');
      const f = (await sql(
        'SELECT name, bytes, size, sha256 FROM import_file WHERE id=$1', [id]))[0];
      if (!f) return 断る(res, 404, 'その原本が見つかりません。');
      const bytes = Buffer.from(f.bytes);
      res.statusCode = 200;
      // 文字の種類は決め打ちしない（銀行が作ったまま）
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(bytes.length));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('x-sha256', f.sha256);
      res.setHeader('Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(f.name || `csv-${id}.csv`)}`);
      return res.end(bytes);
    }

    // ── 一覧 ─────────────────────────────
    const 一覧 = await sql(
      `SELECT id, name, size, sha256,
              to_char(created_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI:SS') AS at
         FROM import_file ORDER BY id`);
    return ok(res, {
      原本: 一覧.map((f) => ({
        id: f.id, 名前: f.name || null, 大きさ: f.size, 指紋: f.sha256, 保存日時: f.at,
      })),
    });
  } catch (e) {
    return fail(res, e, 'daicho-raw');
  }
};
