// 入金管理台帳 — 認証ゲート(Vercel サーバーレス関数)
//
// このサイトへのすべてのリクエストは vercel.json のルート設定でこの関数に集約される。
// Basic 認証(ユーザー名 a / パスワード a)が通るまで、実データ入りの台帳HTMLを一切返さない。
// HTML本体(assets/ledger.html)は関数バンドルにのみ同梱され、静的URLとしては公開されない。
//
// ※ これは「ひとまず隠す」ための簡易認証。ID/パスワードともに a で固定。
//    本運用の前に、環境変数によるパスワード管理か Vercel の Deployment Protection へ移行すること。
const fs = require('fs');
const path = require('path');

const USER = 'a';
const PASS = 'a';
const EXPECTED = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

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

module.exports = (req, res) => {
  const auth = req.headers['authorization'] || '';
  if (auth !== EXPECTED) {
    res.statusCode = 401;
    // realm はHTTPヘッダー値。マルチバイト文字はNodeが弾くのでASCIIにする。
    res.setHeader('WWW-Authenticate', 'Basic realm="Nyukin Daicho", charset="UTF-8"');
    res.setHeader('Content-Type', 'text/plain; charset=UTF-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end('認証が必要です。');
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(loadHtml());
};
