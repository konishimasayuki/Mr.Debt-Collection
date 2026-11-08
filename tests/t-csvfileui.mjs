// 取り込んだCSVの原本：画面から取り込んで、設定に残り、落とせること
import { 開く, 入る, check, 終わる } from './ui.js';
import { client, call, reset } from './h.js';

const CSV = [
  '日付,振込人,お支払金額,お預り金額,残高,メモ',
  '2026/09/10,ｶﾞﾝﾎﾟﾝ ﾀﾛｳ,,30000,100000,',
  '2026/09/10,ｶﾞﾝﾎﾟﾝ ﾊﾅｺ,,50000,150000,',
].join('\r\n') + '\r\n';

await client.connect();
await reset();
await call('setup', { method: 'POST', body: {} });
for (const [名, よみ, 額] of [['原本 太郎', 'ガンポン タロウ', 30000],
                              ['原本 花子', 'ガンポン ハナコ', 50000]]) {
  await call('customers', { method: 'POST', body: {
    名前: 名, よみ, 月々の金額: 額, 回数: 12, 支払日: 10, 開始月: '2026-09' } });
}
await client.end();

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

console.log('■ はじめは1件も無い');
await p.click('.tab:has-text("設定")');
await p.waitForSelector('.sec');
await p.waitForTimeout(700);
const 欄 = p.locator('.sec', { hasText: '取り込んだCSVの原本' });
check('欄がある', (await 欄.count()) === 1);
check('まだ無いと出る', (await 欄.innerText()).includes('まだありません'),
  await 欄.innerText());

console.log('■ 入金登録からCSVを取り込む');
await p.click('.tab:has-text("入金登録")');
// 欄は見えない（押すのは落とす場所のほう）。見えるのを待たずに入れる
await p.waitForSelector('input[type=file]', { state: 'attached' });
await p.waitForTimeout(500);
// 銀行のCSVは Shift_JIS で来ることが多い。そのまま落とし直せるかを見るため、
// 読み取れる形（UTF-8）で入れたうえで、落としたバイトと突き合わせる
await p.setInputFiles('input[type=file]',
  { name: '明細_2026-09.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') });
await p.waitForSelector('.modal-box');
await p.waitForTimeout(800);
check('確認の画面が出る', (await p.locator('.modal-box').count()) === 1);
await p.locator('.modal-foot .btn-main').click();
await p.waitForSelector('.modal-box', { state: 'detached', timeout: 20000 });
await p.waitForTimeout(1200);

console.log('■ 設定に残っている');
await p.click('.tab:has-text("設定")');
await p.waitForSelector('.sec');
await p.waitForTimeout(900);
const 文 = await 欄.innerText();
check('ファイル名が出る', 文.includes('明細_2026-09.csv'), 文);
check('取り込んだ件数が出る', 文.includes('2件'), 文);
check('取り込んだ人が出る', 文.includes('管理者'), 文);
check('日時が出る', /\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/.test(文), 文);
check('大きさが出る', /\d+ KB/.test(文), 文);
check('落とす入口がある', (await 欄.locator('a:has-text("落とす")').count()) === 1);
await 欄.screenshot({ path: '/tmp/csv-1.png' });

console.log('■ 落とすと、入れたものと1バイトも違わない');
const url = await 欄.locator('a:has-text("落とす")').getAttribute('href');
check('原本への道がある', /^\/api\/import\?id=\d+$/.test(url), url);
const 戻り = await p.evaluate(async (u) => {
  const r = await fetch(u);
  const a = new Uint8Array(await r.arrayBuffer());
  return { 型: r.headers.get('content-type'),
           名: r.headers.get('content-disposition'),
           バイト: Array.from(a) };
}, url);
check('CSVとして返る', /text\/csv/.test(戻り.型 || ''), 戻り.型);
check('落とす形で返る', /attachment/.test(戻り.名 || ''), 戻り.名);
check('中身が1バイトも違わない',
  Buffer.from(戻り.バイト).equals(Buffer.from(CSV, 'utf8')),
  [戻り.バイト.length, Buffer.byteLength(CSV)]);

console.log('■ スマホでも横にはみ出さない');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("設定")');
await sp.waitForSelector('.sec');
await sp.waitForTimeout(900);
check('スマホでも出る',
  (await sp.locator('.sec', { hasText: '取り込んだCSVの原本' }).innerText())
    .includes('明細_2026-09.csv'));
check('横にはみ出さない',
  await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await sp.locator('.sec', { hasText: '取り込んだCSVの原本' })
  .screenshot({ path: '/tmp/csv-2-sp.png' });

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
