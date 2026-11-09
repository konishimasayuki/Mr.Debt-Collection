// 目印・月ごとの回収・ダッシュボードの少額隠し
import { 開く, 入る, check, 終わる } from './ui.js';

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.waitForTimeout(900);

// ── 月ごとの回収 ───────────────────────────
console.log('■ 顧客一覧の上に、月ごとの回収が並ぶ');
const 月 = p.locator('.mo');
check('欄がある', (await 月.count()) === 1);
check('見出しが出る', (await 月.innerText()).includes('月ごとの回収'), await 月.innerText());
check('期日の月で数えると書いてある',
  (await 月.innerText()).includes('期日の月で数えています'), await 月.innerText());
check('12か月ぶんまで', (await 月.locator('.mo-c').count()) <= 12,
  await 月.locator('.mo-c').count());
check('新しい月が左', await p.evaluate(() => {
  const 名 = [...document.querySelectorAll('.mo-c b')].map((e) => e.innerText);
  return 名.length >= 2 && 名[0] > 名[1];
}), await p.evaluate(() => [...document.querySelectorAll('.mo-c b')].map((e) => e.innerText)));
check('今月に印が付く', (await 月.locator('.mo-c.now').count()) === 1);
const 先頭 = await 月.locator('.mo-c').first().innerText();
check('入金済みが出る', 先頭.includes('入金済み'), 先頭);
check('残りが出る', 先頭.includes('残り'), 先頭);
// 土台で作った形：8月は払い終え、10月は 79,500 入って 20,500 残り
const 全 = await 月.innerText();
check('入金済みの額が出る', 全.includes('79,500円'), 全);
check('残りの額が出る', 全.includes('20,500円'), 全);
check('全部回収できた月は出さないと書いてある',
  全.includes('全部回収できた月は出しません'), 全);
check('払い終えた8月は出ていない', !全.includes('8月分'), 全);
check('残りが0円の枠は無い', await p.evaluate(() =>
  [...document.querySelectorAll('.mo-left i')].every((e) => e.innerText !== '0円')),
  await p.evaluate(() => [...document.querySelectorAll('.mo-left i')].map((e) => e.innerText)));
check('索引より上にある', await p.evaluate(() => {
  const y = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top : 1e9; };
  return y('.mo') < y('.idx');
}));

// ── 目印 ────────────────────────────────
console.log('■ 目印を付けた人が、索引の上に出る');
const 印 = p.locator('.pin');
check('欄がある', (await 印.count()) === 1);
check('2名出ている', (await 印.locator('.pin-c').count()) === 2,
  await 印.locator('.pin-c').count());
check('名前が出る',
  (await 印.innerText()).includes('アオキ 一郎') && (await 印.innerText()).includes('サトウ 三郎'),
  await 印.innerText());
check('残債が出る', (await 印.innerText()).includes('残債'), await 印.innerText());
check('遅れの印も出る', (await 印.locator('.tag.t-late').count()) >= 1);
check('索引より上にある', await p.evaluate(() => {
  const y = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top : 1e9; };
  return y('.pin') < y('.idx');
}));
check('月ごとの回収より下にある', await p.evaluate(() => {
  const y = (s) => document.querySelector(s).getBoundingClientRect().top;
  return y('.mo') < y('.pin');
}));
await p.screenshot({ path: '/tmp/pin-1.png' });

console.log('■ 目印から顧客ページへ行ける');
await 印.locator('.pin-n', { hasText: 'アオキ 一郎' }).click();
await p.waitForSelector('.rec-top');
await p.waitForTimeout(700);
check('顧客ページが開く', (await p.locator('.cust-name').innerText()).includes('アオキ 一郎'),
  await p.locator('.cust-name').innerText());

console.log('■ 一覧の★で付け外しできる');
await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.waitForTimeout(800);
const 二郎 = p.locator('tbody tr.clickable', { hasText: 'カワダ 二郎' });
check('二郎にはまだ付いていない',
  !(await 二郎.locator('.pin-b').getAttribute('class')).includes('on'),
  await 二郎.locator('.pin-b').getAttribute('class'));
await 二郎.locator('.pin-b').click();
await p.waitForTimeout(900);
check('3名になる', (await p.locator('.pin .pin-c').count()) === 3,
  await p.locator('.pin .pin-c').count());
check('★が点く',
  (await 二郎.locator('.pin-b').getAttribute('class')).includes('on'));
check('★を押しても顧客ページは開かない',
  (await p.locator('.rec-top').count()) === 0);

console.log('■ 顧客ページからも付け外しできる');
// 電話を切ったあと「この人は明日もかける」と思ったその場で押せるように
await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.waitForTimeout(800);
await p.locator('tbody tr.clickable', { hasText: 'カワダ 二郎' }).locator('td.nm b').click();
await p.waitForSelector('.rec-top');
await p.waitForTimeout(800);
const 名の横 = p.locator('.cust-head .pin-big');
check('名前の左に★がある', (await 名の横.count()) === 1);
check('いまの状態を映している',
  (await 名の横.getAttribute('class')).includes('on'),
  await 名の横.getAttribute('class'));
await 名の横.click();
await p.waitForTimeout(900);
check('押すと消える', !(await 名の横.getAttribute('class')).includes('on'),
  await 名の横.getAttribute('class'));
await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.waitForTimeout(900);
check('一覧にも伝わる（2名に戻る）', (await p.locator('.pin .pin-c').count()) === 2,
  await p.locator('.pin .pin-c').count());
check('一覧の★も消えている',
  !(await p.locator('tbody tr.clickable', { hasText: 'カワダ 二郎' })
    .locator('.pin-b').getAttribute('class')).includes('on'));

// もう一度、顧客ページから付け直す
await p.locator('tbody tr.clickable', { hasText: 'カワダ 二郎' }).locator('td.nm b').click();
await p.waitForSelector('.rec-top');
await p.waitForTimeout(800);
await p.locator('.cust-head .pin-big').click();
await p.waitForTimeout(900);
check('付け直せる',
  (await p.locator('.cust-head .pin-big').getAttribute('class')).includes('on'));
await p.locator('.cust-head').screenshot({ path: '/tmp/pin-4.png' });
await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.waitForTimeout(900);
check('一覧でも3名に戻る', (await p.locator('.pin .pin-c').count()) === 3,
  await p.locator('.pin .pin-c').count());

console.log('■ 目印は覚えている（開き直しても残る）');
await p.click('.tab:has-text("ダッシュボード")');
await p.waitForTimeout(500);
await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.waitForTimeout(900);
check('3名のまま', (await p.locator('.pin .pin-c').count()) === 3);

console.log('■ 目印の欄の★で外せる');
await p.locator('.pin .pin-c', { hasText: 'カワダ 二郎' }).locator('.pin-x').click();
await p.waitForTimeout(900);
check('2名に戻る', (await p.locator('.pin .pin-c').count()) === 2,
  await p.locator('.pin .pin-c').count());

console.log('■ 検索しているあいだは、目印の欄を出さない');
await p.locator('.search').fill('アオキ');
await p.waitForTimeout(500);
check('欄が消える', (await p.locator('.pin').count()) === 0);
await p.locator('.search').fill('');
await p.waitForTimeout(500);
check('戻ると出る', (await p.locator('.pin').count()) === 1);

// ── ダッシュボードの少額隠し ──────────────────────
console.log('■ はじめは「出す」（隠していない）');
await p.click('.tab:has-text("ダッシュボード")');
await p.waitForSelector('.dash-m');
await p.waitForTimeout(800);
const 切 = p.locator('.hide-sm');
check('切り替えがある', (await 切.count()) === 1);
check('はじめは入っていない', !(await 切.locator('input').isChecked()));
check('1,000円未満と書いてある', (await 切.innerText()).includes('1,000円'), await 切.innerText());
const 前の行数 = await p.locator('.dash-r').count();
check('端数の行も出ている', 前の行数 === 6, 前の行数);
const 前の未回収 = await p.locator('.dash-m', { hasText: '10月分' }).locator('.dash-h').innerText();
check('10月分の未回収は20,500円', 前の未回収.includes('20,500円'), 前の未回収);

console.log('■ 隠すと、端数だけの行が消える');
await 切.locator('input').check();
await p.waitForTimeout(500);
check('1行減る', (await p.locator('.dash-r').count()) === 前の行数 - 1,
  await p.locator('.dash-r').count());
check('何件隠したかを出す', (await 切.innerText()).includes('1件を隠しています'),
  await 切.innerText());
check('金額は変わらないと書いてある',
  (await 切.innerText()).includes('上の金額は隠しても変わりません'), await 切.innerText());
check('未回収の額は変わらない',
  (await p.locator('.dash-m', { hasText: '10月分' }).locator('.dash-h').innerText())
    .includes('20,500円'),
  await p.locator('.dash-m', { hasText: '10月分' }).locator('.dash-h').innerText());
await p.screenshot({ path: '/tmp/pin-2.png' });

console.log('■ 覚えない（開き直すと「出す」に戻る）');
await p.click('.tab:has-text("顧客一覧")');
await p.waitForTimeout(500);
await p.click('.tab:has-text("ダッシュボード")');
await p.waitForSelector('.dash-m');
await p.waitForTimeout(800);
check('切り替えが戻っている', !(await p.locator('.hide-sm input').isChecked()));
check('行も戻っている', (await p.locator('.dash-r').count()) === 前の行数);

console.log('■ スマホでも横にはみ出さない');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("顧客一覧")');
await sp.waitForSelector('tbody tr.clickable');
await sp.waitForTimeout(900);
check('月ごとの回収が出る', (await sp.locator('.mo').count()) === 1);
check('目印が出る', (await sp.locator('.pin').count()) === 1);
check('横にはみ出さない',
  await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await sp.screenshot({ path: '/tmp/pin-3-sp.png' });

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
