// ログインの確認。画面もAPIも同じ判定を使う。
//
// 利用者名とパスワードは環境変数で決める。入れていなければ a / a で動く
// (手元で試すため)。実データを置く場所では必ず入れること。
// ※ まだ全員が同じ合鍵を使う簡易認証。担当者ごとの利用者は未実装。
import { createHash } from 'node:crypto';

const USER = process.env.LEDGER_USER || 'a';
const PASS = process.env.LEDGER_PASS || 'a';

const COOKIE_NAME = 'nyukin_session';
// クッキーに入れる合鍵。SESSION_SECRET とパスワードから作るので、
// パスワードを変えれば古いクッキーは自動で使えなくなる。
// HTTPヘッダには ASCII しか置けないため、16進の文字列にしている。
const SESSION_TOKEN = 'ok.v1.' + createHash('sha256')
  .update(`${process.env.SESSION_SECRET || 'kaigi-no-aikagi'}|${USER}|${PASS}`)
  .digest('hex').slice(0, 32);
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

export { USER, PASS, COOKIE_NAME, SESSION_TOKEN, MAX_AGE,
                   hasSession, requireSession, recordedBy };
