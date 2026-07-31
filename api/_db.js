// データベース(Neon / PostgreSQL)への接続。
// 接続情報は Vercel の環境変数から来る(DATABASE_URL)。画面からは直接触らせない。
import { neon } from '@neondatabase/serverless';
import { STATEMENTS } from './_schema.js';

let sql = null;
let 作り直した = false;   // 1つの処理の中で、作り直しは一度だけ

// 検査のときだけ、別の接続に差し替えられるようにする
function setDb(fn) { sql = (t, p) => withSetup(fn, t, p); 作り直した = false; }

// テーブルが無いと言われたら、一度だけ作り直してやり直す。
// テーブルを増やしたあと、画面から「用意する」を押さなくても追いつくため。
// 42P01 = undefined_table。ふだんは通らない道なので、速さには響かない。
async function withSetup(run, t, p) {
  try {
    return await run(t, p);
  } catch (e) {
    if ((e && e.code) !== '42P01' || 作り直した) throw e;
    作り直した = true;
    console.warn('[db] テーブルが足りないので作り直します:', e.message);
    for (const stmt of STATEMENTS) await run(stmt);
    return run(t, p);
  }
}

function db() {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL が設定されていません。');
    const raw = neon(url);
    sql = (t, p) => withSetup(raw, t, p);
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

export { db, setDb, fail, ok };
