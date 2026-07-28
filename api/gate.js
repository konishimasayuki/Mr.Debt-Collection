// 入金管理台帳 — 認証ゲート(Vercel サーバーレス関数)
//
// このサイトへのすべてのリクエストは vercel.json のルート設定でこの関数に集約される。
// ログインが通るまで、実データ入りの台帳HTMLを一切返さない。
// HTML本体(assets/ledger.html)は関数バンドルにのみ同梱され、静的URLとしては公開されない。
//
// 認証方式: 台帳の見た目に合わせた専用ログイン画面 + Cookie セッション。
// ブラウザ標準の Basic 認証ポップアップは使わない。
//
// ※ これは「ひとまず隠す」ための簡易認証。ID/パスワードともに a で固定。
//    本運用の前に、パスワードを環境変数へ、またはVercelのDeployment Protectionへ移行すること。
const fs = require('fs');
const path = require('path');
const { USER, PASS, COOKIE_NAME, SESSION_TOKEN, MAX_AGE, hasSession } = require('./_auth');

let cached = null;
function loadHtml() {
  if (cached) return cached;
  const candidates = [
    path.join(process.cwd(), 'assets', 'ledger.html'),
    path.join(__dirname, '..', 'assets', 'ledger.html'),
    path.join(__dirname, 'assets', 'ledger.html'),
  ];
  for (const p of candidates) {
    try { cached = fs.readFileSync(p); break; } catch (e) { /* 次の候補へ */ }
  }
  if (!cached) throw new Error('assets/ledger.html が見つかりません');
  return cached;
}

// POSTボディ(application/x-www-form-urlencoded)を取り出す。
// @vercel/node が req.body に入れている場合と、生ストリームの両方に対応する。
function readForm(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string' && req.body.length) {
      return resolve(Object.fromEntries(new URLSearchParams(req.body)));
    }
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
    req.on('error', () => resolve({}));
  });
}

function loginPage(err) {
  const notice = err
    ? '<p class="err" role="alert">ユーザー名かパスワードが違います。</p>'
    : '';
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>入金管理台帳 — ログイン</title>
<style>
  :root{
    --paper:#FBFAF7; --paper-2:#F3F1EB; --ink:#16181A; --ink-2:#5A5F63;
    --ink-3:#8A8F93; --rule:#D9D5CB; --rule-strong:#A9A399; --indigo:#1F3A5F;
    --indigo-2:#33547F; --overdue:#8C2F26;
    --sans:"Hiragino Kaku Gothic ProN","Yu Gothic Medium","YuGothic","Noto Sans JP","Meiryo",sans-serif;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;height:100%;}
  body{
    background:var(--paper-2); color:var(--ink); font-family:var(--sans);
    display:flex; align-items:center; justify-content:center; padding:24px;
    -webkit-font-smoothing:antialiased;
  }
  .card{
    width:100%; max-width:360px; background:var(--paper);
    border:1px solid var(--rule); border-top:3px solid var(--indigo);
    padding:30px 28px 26px; box-shadow:0 8px 30px rgba(31,58,95,.08);
  }
  .title{font-size:19px; font-weight:700; letter-spacing:.14em; margin:0 0 4px;}
  .sub{font-size:12.5px; color:var(--ink-2); letter-spacing:.04em; margin:0 0 22px;}
  label{display:block; font-size:12px; color:var(--ink-2); letter-spacing:.08em; margin:0 0 5px;}
  .field{margin-bottom:16px;}
  input[type=text],input[type=password]{
    width:100%; font-family:inherit; font-size:16px; color:var(--ink);
    padding:10px 12px; background:#fff; border:1px solid var(--rule-strong);
    border-radius:2px;
  }
  input:focus{outline:2px solid var(--indigo); outline-offset:1px; border-color:var(--indigo);}
  .btn{
    width:100%; font-family:inherit; font-size:16px; font-weight:700; letter-spacing:.06em;
    padding:12px; margin-top:6px; background:var(--indigo); color:#fff;
    border:1px solid var(--indigo); border-radius:2px; cursor:pointer;
  }
  .btn:hover{background:var(--indigo-2); border-color:var(--indigo-2);}
  .err{
    font-size:13px; color:var(--overdue); background:#F7ECE9;
    border:1px solid var(--overdue); border-radius:2px; padding:9px 11px; margin:0 0 16px;
  }
  .note{font-size:11.5px; color:var(--ink-3); line-height:1.7; margin:18px 0 0;
    border-top:1px dotted var(--rule); padding-top:12px;}
</style>
</head>
<body>
  <form class="card" method="post" action="/" autocomplete="off">
    <h1 class="title">入金管理台帳</h1>
    <p class="sub">関係者用。ログインしてください。</p>
    ${notice}
    <div class="field">
      <label for="u">ユーザー名</label>
      <input id="u" name="user" type="text" inputmode="latin" autocapitalize="off"
             autocorrect="off" autofocus required>
    </div>
    <div class="field">
      <label for="p">パスワード</label>
      <input id="p" name="pass" type="password" required>
    </div>
    <button class="btn" type="submit">ログイン</button>
    <p class="note">この画面は督促・入金管理の担当者向けです。<br>
      画面には実際の氏名や金額が表示されます。取り扱いに注意してください。</p>
  </form>
</body>
</html>`;
}

function sendHtml(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(body);
}

module.exports = async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();

  // ログイン送信
  if (method === 'POST') {
    const form = await readForm(req);
    if (form.user === USER && form.pass === PASS) {
      // Set-Cookie / Location はHTTPヘッダー値。ASCIIのみ。
      res.statusCode = 303;
      res.setHeader('Set-Cookie',
        `${COOKIE_NAME}=${SESSION_TOKEN}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
      res.setHeader('Location', '/');
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return;
    }
    sendHtml(res, 401, loginPage(true));
    return;
  }

  // すでにログイン済みなら台帳を返す
  if (hasSession(req)) {
    sendHtml(res, 200, loadHtml());
    return;
  }

  // 未ログインはログイン画面(標準ポップアップは出さない)
  sendHtml(res, 200, loginPage(false));
};
