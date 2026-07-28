// データベース(Neon / PostgreSQL)への接続。
// 接続情報は Vercel の環境変数から来る(DATABASE_URL)。画面からは直接触らせない。
const { neon } = require('@neondatabase/serverless');

let sql = null;
function db() {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL が設定されていません。');
    sql = neon(url);
  }
  return sql;
}

// 原因が分からないと直せないので、ログイン済みの相手には理由を返す。
// 接続情報は含めない(メッセージと符号だけを渡す)。
function fail(res, e, where) {
  console.error(`[${where}]`, e);
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    error: 'データベースの処理に失敗しました。',
    どこで: where,
    理由: e && e.message ? String(e.message).slice(0, 300) : '不明',
    符号: (e && e.code) || null,
  }));
}

function ok(res, body) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = { db, fail, ok };
