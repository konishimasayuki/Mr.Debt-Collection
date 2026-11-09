// 口座台帳へ原本を渡す口（api/daicho-raw.js）。読むだけで、合鍵が無いと何も返さない
import { client, call, check, done, reset } from './h.js';
import handler from '../api/daicho-raw.js';

const KEY = 'kensa-no-aikagi-0123456789abcdef';

// 口を直に呼ぶ。クッキーは付けない（台帳のサーバーから呼ばれる形）
function 呼ぶ({ method = 'GET', q, key } = {}) {
  const url = '/api/daicho-raw' + (q ? '?' + new URLSearchParams(q) : '');
  const req = { method, url, headers: key === undefined ? {} : { 'x-daicho-key': key } };
  let 済; const p = new Promise((r) => (済 = r));
  const res = {
    statusCode: 200, _h: {},
    setHeader(k, v) { this._h[String(k).toLowerCase()] = v; },
    end(s) {
      let b = {};
      try { b = JSON.parse(Buffer.isBuffer(s) ? '' : (s || '{}')); } catch { /* 原本はJSONではない */ }
      済({ code: res.statusCode, body: b, raw: s, headers: res._h });
    },
  };
  handler(req, res);
  return p;
}

// Shift_JIS の銀行CSVに近いバイト列（UTF-8 に直さずに残ることを見るため、わざと UTF-8 で読めない並びを入れる）
const 原本 = Buffer.concat([
  Buffer.from('日付,振込人,お支払金額,お預り金額\r\n', 'utf8'),
  Buffer.from([0x82, 0xa0, 0x82, 0xa2, 0x2c, 0x31, 0x30, 0x30, 0x0d, 0x0a]),
]);
const CSV = ['日付,振込人,お支払金額,お預り金額',
  '2026/09/10,ﾀﾞｲﾁｮｳ ﾀﾛｳ,,30000'].join('\r\n') + '\r\n';

(async () => {
  await client.connect();
  await reset();
  await call('setup', { method: 'POST', body: {} });

  console.log('■ 合鍵が入っていないときは、だれにも返さない');
  delete process.env.DAICHO_READ_KEY;
  let r = await 呼ぶ({ key: KEY });
  check('503', r.code === 503, r);
  process.env.DAICHO_READ_KEY = '   ';
  r = await 呼ぶ({ key: '   ' });
  check('空白だけの合鍵も入っていない扱い', r.code === 503, r);

  process.env.DAICHO_READ_KEY = KEY;

  console.log('■ 合鍵が無い・違うときは断る');
  r = await 呼ぶ();
  check('見出しが無いと401', r.code === 401, r);
  r = await 呼ぶ({ key: KEY + 'x' });
  check('違う合鍵は401', r.code === 401, r);
  r = await 呼ぶ({ key: KEY.slice(0, -1) });
  check('1文字足りない合鍵は401', r.code === 401, r);
  r = await 呼ぶ({ key: '' });
  check('空の合鍵は401', r.code === 401, r);

  console.log('■ 画面のログイン（クッキー）では通らない');
  r = await call('import');   // 比べるために、今の取り込みの口をクッキーで呼ぶ
  check('（参考）今の取り込みの口はクッキーで通る', r.code === 200, r.code);
  const viaCookie = await new Promise((ok) => {
    const res = { statusCode: 200, _h: {}, setHeader() {}, end() { ok(res.statusCode); } };
    handler({ method: 'GET', url: '/api/daicho-raw', headers: { cookie: 'nyukin_session=x' } }, res);
  });
  check('クッキーだけでは401', viaCookie === 401, viaCookie);

  console.log('■ 書き込みの道は無い');
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    r = await 呼ぶ({ method: m, key: KEY });
    check(`${m} は405`, r.code === 405, r.code);
  }

  console.log('■ 貼り付けで前後に空白・改行が付いても通る');
  process.env.DAICHO_READ_KEY = KEY + '\n';
  r = await 呼ぶ({ key: ' ' + KEY });
  check('環境変数の末尾の改行・見出しの先頭の空白を取り除いて比べる', r.code === 200, r);
  process.env.DAICHO_READ_KEY = KEY;

  console.log('■ はじめは空');
  r = await 呼ぶ({ key: KEY });
  check('200', r.code === 200, r);
  check('0件', Array.isArray(r.body.原本) && r.body.原本.length === 0, r.body);

  console.log('■ 取り込んだ原本が一覧に出る');
  const p = await call('import', { method: 'POST', body: { text: CSV } });
  await call('import', { method: 'POST', body: {
    実行: true, 明細: p.body.明細,
    原本: { 名前: '明細_A.csv', 中身: Buffer.from(CSV).toString('base64') } } });
  // UTF-8 で読めない原本も、そのまま置く（今の取り込みの口を通す）
  await call('import', { method: 'POST', body: {
    実行: true, 明細: p.body.明細,
    原本: { 名前: '明細_B.csv', 中身: 原本.toString('base64') } } });

  r = await 呼ぶ({ key: KEY });
  const 一覧 = r.body.原本;
  check('2件', 一覧.length === 2, 一覧);
  check('古い順', 一覧[0].id < 一覧[1].id, 一覧.map((x) => x.id));
  check('名前', 一覧[0].名前 === '明細_A.csv', 一覧[0]);
  check('大きさ', 一覧[1].大きさ === 原本.length, [一覧[1].大きさ, 原本.length]);
  check('指紋は sha256 の全部（64文字）', /^[0-9a-f]{64}$/.test(一覧[0].指紋), 一覧[0].指紋);
  check('保存日時', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(一覧[0].保存日時), 一覧[0].保存日時);
  check('中身は一覧に入れない', !('bytes' in 一覧[0]) && !('中身' in 一覧[0]), Object.keys(一覧[0]));
  check('記録を残さない', r.headers['cache-control'] === 'no-store', r.headers);
  check('ほかのサイトから呼ぶ許可を付けない', !r.headers['access-control-allow-origin'], r.headers);

  console.log('■ 原本は、入れたバイトのまま返る');
  const { createHash } = await import('node:crypto');
  r = await 呼ぶ({ key: KEY, q: { id: 一覧[1].id } });
  check('200', r.code === 200, r.code);
  const 戻り = Buffer.isBuffer(r.raw) ? r.raw : Buffer.from(String(r.raw), 'binary');
  check('1バイトも違わない（UTF-8 で読めない並びも）', 戻り.equals(原本), [戻り.length, 原本.length]);
  check('見出しの指紋と、返したバイトの指紋が同じ',
    r.headers['x-sha256'] === createHash('sha256').update(戻り).digest('hex'), r.headers['x-sha256']);
  check('見出しの指紋と、一覧の指紋が同じ', r.headers['x-sha256'] === 一覧[1].指紋, r.headers['x-sha256']);
  check('文字の種類を決め打ちしない', r.headers['content-type'] === 'application/octet-stream',
    r.headers['content-type']);
  check('記録を残さない', r.headers['cache-control'] === 'no-store', r.headers);

  console.log('■ 変な id は断る');
  for (const bad of ['0', '-1', '1.5', 'abc', '1;DROP TABLE import_file', '']) {
    r = await 呼ぶ({ key: KEY, q: { id: bad } });
    check(`id=${JSON.stringify(bad)} は400`, r.code === 400, r.code);
  }
  r = await 呼ぶ({ key: KEY, q: { id: '9999' } });
  check('無い id は404', r.code === 404, r.code);
  r = await 呼ぶ({ q: { id: String(一覧[0].id) } });
  check('合鍵が無ければ原本も返さない', r.code === 401, r.code);

  console.log('■ 原本の表は変わっていない（読むだけ）');
  const n = (await client.query('SELECT count(*)::int n FROM import_file')).rows[0].n;
  check('2件のまま', n === 2, n);

  await done();
})().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
