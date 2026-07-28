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

// エラーの中身は画面に出さない(接続情報が混ざりうるため)。記録には残す。
function fail(res, e, where) {
  console.error(`[${where}]`, e);
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: 'データベースの処理に失敗しました。' }));
}

function ok(res, body) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = { db, fail, ok };
