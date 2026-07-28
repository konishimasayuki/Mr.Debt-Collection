// ログインの確認。画面もAPIも同じ判定を使う。
// ※ 暫定の簡易認証(ユーザー名 a / パスワード a)。本運用の前に、
//    パスワードを環境変数へ、または担当者ごとの利用者に置き換えること。
const USER = 'a';
const PASS = 'a';

const COOKIE_NAME = 'nyukin_session';
const SESSION_TOKEN = 'ok.v1.8f3c1a9e5b2d47';
const MAX_AGE = 60 * 60 * 8; // 8時間

function hasSession(req) {
  const raw = req.headers['cookie'] || '';
  return raw.split(';').some((c) => {
    const [k, v] = c.trim().split('=');
    return k === COOKIE_NAME && v === SESSION_TOKEN;
  });
}

// 記録者。担当者ごとの利用者を作るまでは、ログイン中の利用者名を入れる。
function recordedBy(req) {
  return hasSession(req) ? '管理者' : '不明';
}

// APIの入口で使う。未ログインなら401を返して false。
function requireSession(req, res) {
  if (hasSession(req)) return true;
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: 'ログインが必要です。' }));
  return false;
}

module.exports = { USER, PASS, COOKIE_NAME, SESSION_TOKEN, MAX_AGE,
                   hasSession, requireSession, recordedBy };
