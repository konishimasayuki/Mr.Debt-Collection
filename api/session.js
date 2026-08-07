// ログイン。画面は静的に配り、データを触るAPIだけをこの合鍵で守る。
// GET    /api/session        … いまログインしているか
// GET    /api/session?顧客=1 … ログインしているか ＋ 顧客一覧・ダッシュボード（開いた直後用）
// POST   /api/session        … {user, pass} でログイン
// DELETE /api/session        … ログアウト
import { USER, PASS, COOKIE_NAME, SESSION_TOKEN, MAX_AGE, hasSession } from './_auth.js';
import { readBody, query } from './_lib.js';
import { db } from './_db.js';
import { 顧客一覧 } from './_list.js';
import { ダッシュボード } from './_dash.js';

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
    const 入っている = hasSession(req);
    const 返事 = { ログイン中: 入っている, 利用者: 入っている ? '管理者' : null };

    // 画面を開いた直後は、ログイン確認・顧客一覧・ダッシュボードを続けて聞いていた。
    // サーバーは遠く、しばらく使われないと眠るので、1回目の往復に待ち時間がかかる。
    // それが3回続くと、開いた直後がまるまる待ち時間になる。
    // ここで一緒に返せば往復は1回で済む。
    // ダッシュボードは開いて最初に出すタブなので、顧客一覧と同格で同梱する。
    if (入っている && query(req)['顧客']) {
      const [一覧, ダッシュ] = await Promise.allSettled([
        顧客一覧(db()), ダッシュボード(db()),
      ]);
      if (一覧.status === 'fulfilled') Object.assign(返事, 一覧.value);
      // 一覧が取れなくても、ログインの確認だけは返す。
      // 画面は入っていなければ自分で取りに行くので、そこで理由が出る。
      else console.error('[session] 顧客一覧を同梱できませんでした:', 一覧.reason && 一覧.reason.message);
      if (ダッシュ.status === 'fulfilled') 返事.ダッシュボード = ダッシュ.value;
      else console.error('[session] ダッシュボードを同梱できませんでした:', ダッシュ.reason && ダッシュ.reason.message);
    }
    return json(res, 200, 返事);
  }
  if (method === 'POST') {
    const b = await readBody(req);
    if (String(b.user || '') !== USER || String(b.pass || '') !== PASS) {
      return json(res, 401, { error: '利用者名かパスワードが違います。' });
    }
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
