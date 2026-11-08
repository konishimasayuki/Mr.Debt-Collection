// 取り込んだCSVの原本を残す
import { client, call, check, done, reset } from './h.js';

// 実際の銀行CSVに近い形（全銀協規定形式ではない、よくある見出しつきのCSV）
const CSV = [
  '日付,振込人,お支払金額,お預り金額,残高,メモ',
  '2026/09/10,ｶﾞﾝﾎﾟﾝ ﾀﾛｳ,,30000,100000,',
  '2026/09/10,ｶﾞﾝﾎﾟﾝ ﾊﾅｺ,,50000,150000,',
].join('\r\n') + '\r\n';

const b64 = (s, enc) => Buffer.from(s, enc || 'utf8').toString('base64');

(async () => {
  await client.connect();
  await reset();
  await call('setup', { method: 'POST', body: {} });
  const 作る = async (o) => (await call('customers', { method: 'POST', body: o })).body;
  const 一覧 = async () => (await call('import')).body.ファイル;

  const A = await 作る({ 名前: '原本 太郎', よみ: 'ガンポン タロウ',
    月々の金額: 30000, 回数: 12, 支払日: 10, 開始月: '2026-09' });
  const B = await 作る({ 名前: '原本 花子', よみ: 'ガンポン ハナコ',
    月々の金額: 50000, 回数: 12, 支払日: 10, 開始月: '2026-09' });

  console.log('■ はじめは1件も無い');
  check('空', (await 一覧()).length === 0, await 一覧());

  console.log('■ 確認（プレビュー）では残さない');
  const p = await call('import', { method: 'POST', body: { text: CSV } });
  check('読み取れる', p.code === 200, p.body);
  check('2件読めた', p.body.明細.length === 2, p.body.明細.length);
  check('確認しただけでは残らない', (await 一覧()).length === 0, await 一覧());

  console.log('■ 取り込むと原本が残る');
  const r = await call('import', { method: 'POST', body: {
    実行: true, 明細: p.body.明細,
    原本: { 名前: '明細_2026-09.csv', 中身: b64(CSV) } } });
  check('取り込める', r.code === 200, r.body);
  check('2件入った', r.body.取り込んだ件数 === 2, r.body);
  check('原本を残したと返す', r.body.原本を残した === true, r.body);

  let f = await 一覧();
  check('1件になる', f.length === 1, f);
  check('ファイル名が残る', f[0].名前 === '明細_2026-09.csv', f[0].名前);
  check('大きさが合う', f[0].大きさ === Buffer.byteLength(CSV), [f[0].大きさ, Buffer.byteLength(CSV)]);
  check('取り込んだ件数が残る', f[0].取り込んだ件数 === 2, f[0].取り込んだ件数);
  check('いま残っている入金が2件', f[0].いま残っている入金 === 2, f[0].いま残っている入金);
  check('取り込んだ人が残る', f[0].取り込んだ人 === '管理者', f[0].取り込んだ人);
  check('日時が残る', /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(f[0].取り込んだ日時),
    f[0].取り込んだ日時);
  check('指紋が出る', /^[0-9a-f]{12}$/.test(f[0].指紋), f[0].指紋);

  console.log('■ 落とすと、入れたものと1バイトも違わない');
  const d = await call('import', { q: { id: f[0].id } });
  check('200で返る', d.code === 200, d.code);
  const 戻り = Buffer.isBuffer(d.raw) ? d.raw : Buffer.from(String(d.raw), 'binary');
  check('中身が同じ', 戻り.equals(Buffer.from(CSV, 'utf8')),
    [戻り.length, Buffer.byteLength(CSV)]);
  check('CSVとして返す', /text\/csv/.test(d.headers['content-type'] || ''),
    d.headers['content-type']);
  check('落とす形で返す', /attachment/.test(d.headers['content-disposition'] || ''),
    d.headers['content-disposition']);
  check('ファイル名が付く',
    /%E6%98%8E%E7%B4%B0/.test(d.headers['content-disposition'] || ''),
    d.headers['content-disposition']);

  console.log('■ どの入金が、どのファイルから来たか');
  const 紐 = (await client.query(
    'SELECT count(*)::int n FROM payment WHERE import_file_id IS NOT NULL')).rows[0].n;
  check('2件の入金にファイルが紐づく', 紐 === 2, 紐);

  console.log('■ Shift_JIS のファイルも、文字を直さずそのまま残す');
  const SJ = CSV.replace('2026/09/10', '2026/11/10');
  // 画面は Shift_JIS を UTF-8 に直して読むが、原本は直す前のバイトを送る
  const sjBytes = Buffer.from([0x93, 0xfa, 0x95, 0x74, 0x0d, 0x0a]);  // 「日付」CRLF
  const p2 = await call('import', { method: 'POST', body: { text: SJ } });
  const r2 = await call('import', { method: 'POST', body: {
    実行: true, 明細: p2.body.明細,
    原本: { 名前: 'sjis.csv', 中身: sjBytes.toString('base64') } } });
  check('取り込める', r2.code === 200, r2.body);
  f = await 一覧();
  const sj = f.find((x) => x.名前 === 'sjis.csv');
  check('残っている', !!sj, f.map((x) => x.名前));
  const d2 = await call('import', { q: { id: sj.id } });
  const 戻り2 = Buffer.isBuffer(d2.raw) ? d2.raw : Buffer.from(String(d2.raw), 'binary');
  check('バイトがそのまま', 戻り2.equals(sjBytes), [...戻り2]);

  console.log('■ 同じファイルを二度取り込んでも、置き場は増えない');
  const 前 = (await 一覧()).length;
  const p3 = await call('import', { method: 'POST', body: { text: CSV } });
  await call('import', { method: 'POST', body: {
    実行: true, 明細: p3.body.明細,
    原本: { 名前: '明細_2026-09.csv', 中身: b64(CSV) } } });
  check('増えていない', (await 一覧()).length === 前, [(await 一覧()).length, 前]);

  console.log('■ 原本を送らなくても取り込める（古い画面から来たとき）');
  const CSV2 = CSV.replace('2026/09/10', '2026/10/10');
  const p4 = await call('import', { method: 'POST', body: { text: CSV2 } });
  const r4 = await call('import', { method: 'POST', body: {
    実行: true, 明細: p4.body.明細 } });
  check('取り込める', r4.code === 200, r4.body);
  check('原本は残らないと返す', r4.body.原本を残した === false, r4.body);

  console.log('■ 大きすぎるものは断る');
  const 大 = await call('import', { method: 'POST', body: {
    実行: true, 明細: p.body.明細,
    原本: { 名前: 'でかい.csv', 中身: Buffer.alloc(11 * 1024 * 1024, 97).toString('base64') } } });
  check('400で断る', 大.code === 400, 大.code);
  check('理由が分かる', /大きすぎ/.test((大.body && 大.body.error) || ''), 大.body);

  console.log('■ 無い番号は404');
  const な = await call('import', { q: { id: 9999 } });
  check('404', な.code === 404, な.code);

  console.log('■ 顧客id の割り当ても壊れていない');
  const 紐2 = (await client.query(
    'SELECT count(*)::int n FROM payment WHERE customer_id IS NOT NULL')).rows[0].n;
  check('顧客に紐づいた', 紐2 >= 2, 紐2);

  await client.end();
  done();
})();
