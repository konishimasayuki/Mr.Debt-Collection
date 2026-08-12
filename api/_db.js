// データベース(Neon / PostgreSQL)への接続。
// 接続情報は Vercel の環境変数から来る(DATABASE_URL)。画面からは直接触らせない。
import { neon } from '@neondatabase/serverless';
import { STATEMENTS } from './_schema.js';

let sql = null;
let 作り直し = null;   // 1つの処理の中で、作り直しは一度だけ（同時に走らせない）

// 検査のときだけ、別の接続に差し替えられるようにする
function setDb(fn) { sql = (t, p) => withSetup(fn, t, p); 作り直し = null; }

// テーブルや列が足りないと言われたら、一度だけ作り直してやり直す。
// 増やしたあと、画面から「用意する」を押さなくても追いつくため。
// 42P01 = テーブルが無い / 42703 = 列が無い。
// ふだんは通らない道なので、速さには響かない。
// 同時に投げた問い合わせが揃って足りないと言うこともあるので、
// 作り直しは1つにまとめ、みんなで同じものを待つ。
const 足りない = new Set(['42P01', '42703']);
async function withSetup(run, t, p) {
  try {
    return await run(t, p);
  } catch (e) {
    if (!足りない.has(e && e.code)) throw e;
    if (!作り直し) {
      console.warn('[db] テーブルか列が足りないので作り直します:', e.message);
      // 途中の1文でつまずいても、残りの文は流す。
      // 1文で止めると、そのあとに書いてある「列を足す」文まで届かず、
      // いつまでも足りないままになる（画面がまるごと開けなくなる）。
      作り直し = (async () => {
        for (const stmt of STATEMENTS) {
          try {
            await run(stmt);
          } catch (e2) {
            console.warn('[db] この文は流せませんでした:',
              String(stmt).slice(0, 80).replace(/\s+/g, ' '), '→', e2 && e2.message);
          }
        }
      })();
      // 流し終えたら、次にまた足りないと言われたときのために手を空ける。
      // 持ったままにすると、この処理が生きているあいだ二度と作り直せない。
      // 増やした列が2つ目・3つ目と続いたときに、あとのぶんが当たらなくなる。
      作り直し.finally(() => { 作り直し = null; });
    }
    await 作り直し;
    return run(t, p);   // やり直しは一度だけ(ここで駄目ならそのまま知らせる)
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
