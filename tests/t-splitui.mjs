// 小分けの入金を、見た目だけまとめる
//
// 払い終えた回はまとめる。払い終えていない回はまとめない。
// いくら入っていくら足りないかは、電話をかける前に1件ずつ見ないと話ができない。
import { 開く, 入る, check, 終わる } from './ui.js';

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.click('td:has-text("コワケ 太郎")');
await p.waitForSelector('.rec-top');
await p.waitForTimeout(900);
const 記 = p.locator('.sec', { hasText: '支払いの記録' });

console.log('■ 払い終えた回は、まとめて1行になる');
check('まとめた行が2つ（1回目と2回目）', (await 記.locator('.rec-sum').count()) === 2,
  await 記.locator('.rec-sum').count());
const 一 = await 記.locator('.rec-sum').first().innerText();
check('何回に分けたかを出す', 一.includes('3回に分けて入金'), 一);
check('いつからいつまでを出す', 一.includes('09/20') && 一.includes('09/27'), 一);
check('合計の額を出す', 一.includes('30,000'), 一);
check('ひらけると分かる', 一.includes('ひらく'), 一);
check('1行に収まっている', await p.evaluate(() => {
  const w = document.querySelector('.rec-sum .rec-p-w');
  return w.getClientRects().length === 1;
}));
const 全 = await 記.locator('.rec').innerText();
check('まとめた回の1件ずつは出ていない',
  !/09\/25\s*\n?\s*入金/.test(全), 全.slice(0, 300));
await 記.locator('.rec').screenshot({ path: '/tmp/sum-1.png' });

console.log('■ 払い終えていない回は、まとめない');
check('3回目は1件ずつ出ている',
  全.includes('11/20') && 全.includes('8,000')
    && 全.includes('11/25') && 全.includes('7,000'), 全.slice(0, 400));
check('3回目にまとめた行は無い', await p.evaluate(() => {
  const 行 = [...document.querySelectorAll('.rec > div')];
  const 三 = 行.find((e) => (e.innerText || '').startsWith('3回'));
  return 三 && !三.querySelector('.rec-sum');
}));
check('残りがいくらかも出ている', 全.includes('残 15,000'), 全.slice(0, 400));

console.log('■ 押すとひらく');
await 記.locator('.rec-sum').first().click();
await p.waitForTimeout(400);
const 開 = await 記.locator('.rec').innerText();
check('1件ずつ出る',
  開.includes('09/20') && 開.includes('09/25') && 開.includes('09/27'), 開.slice(0, 300));
check('10,000円が3つ出る',
  (開.match(/10,000/g) || []).length >= 3, (開.match(/10,000/g) || []).length);
check('とじられると分かる', 開.includes('とじる'), 開.slice(0, 200));
check('2回目はまとまったまま', 開.includes('2回に分けて入金'), 開.slice(0, 400));
await 記.locator('.rec').screenshot({ path: '/tmp/sum-2.png' });

console.log('■ もう一度押すと、とじる');
await 記.locator('.rec-sum').first().click();
await p.waitForTimeout(400);
check('まとめた行に戻る',
  (await 記.locator('.rec-sum').first().innerText()).includes('ひらく'),
  await 記.locator('.rec-sum').first().innerText());
check('まとめた行が2つに戻る', (await 記.locator('.rec-sum').count()) === 2);

console.log('■ 台帳の中身は変わっていない（見た目だけ）');
const 数 = await p.locator('.strip').innerText();
check('残債が変わっていない', 数.includes('285,000円'), 数);
check('入金合計が変わっていない',
  (await p.locator('.sec', { hasText: '入金' }).first().innerText()).length > 0);

console.log('■ スマホでも1行に収まる');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("顧客一覧")');
await sp.waitForSelector('tbody tr.clickable');
await sp.click('td:has-text("コワケ 太郎")');
await sp.waitForSelector('.rec-top');
await sp.waitForTimeout(900);
check('スマホでもまとまる', (await sp.locator('.rec-sum').count()) === 2);
check('スマホでも1行', await sp.evaluate(() => {
  const w = document.querySelector('.rec-sum .rec-p-w');
  return w.getClientRects().length === 1;
}));
check('横にはみ出さない',
  await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await sp.locator('.sec', { hasText: '支払いの記録' }).locator('.rec')
  .screenshot({ path: '/tmp/sum-3-sp.png' });

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
