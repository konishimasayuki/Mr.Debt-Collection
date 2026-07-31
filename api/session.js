// ログイン。画面は静的に配り、データを触るAPIだけをこの合鍵で守る。
// GET    /api/session … いまログインしているか
// POST   /api/session … {user, pass} でログイン
// DELETE /api/session … ログアウト
import { USER, PASS, COOKIE_NAME, SESSION_TOKEN, MAX_AGE, hasSession } from './_auth.js';
import { readBody } from './_lib.js';

const json = (res, code, body, cookie) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.end(JSON.stringify(body));
};

export default async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'GET') {
    return json(res, 200, { ログイン中: hasSession(req), 利用者: hasSession(req) ? '管理者' : null });
  }

  if (method === 'POST') {
    const b = await readBody(req);
    if (String(b.user || '') !== USER || String(b.pass || '') !== PASS) {
      return json(res, 401, { error: '利用者名かパスワードが違います。' });
    }
    // HttpOnly:画面のJSから読ませない / SameSite=Lax:他サイトから送らせない
    const cookie = `${COOKIE_NAME}=${SESSION_TOKEN}; Path=/; Max-Age=${MAX_AGE}`
      + '; HttpOnly; Secure; SameSite=Lax';
    return json(res, 200, { ログイン中: true, 利用者: '管理者' }, cookie);
  }

  if (method === 'DELETE') {
    return json(res, 200, { ログイン中: false },
      `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  }

  return json(res, 405, { error: '対応していない操作です。' });
};
