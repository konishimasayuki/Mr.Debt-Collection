// ダッシュボード：％をやめ、月ごとの予定回収額を出す
import { 開く, 入る, check, 終わる } from './ui.js';

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.click('.tab:has-text("ダッシュボード")');
await p.waitForSelector('.dash-m');
await p.waitForTimeout(700);

console.log('■ ％は出さない');
const 全文 = await p.locator('.dash-m').first().innerText();
check('見出しに％が無い', !/\d+%/.test(全文), 全文.slice(0, 200));
check('％の欄そのものが無い',
  (await p.locator('.dash-p:text-matches("%")').count()) === 0);

console.log('■ 予定回収額が、％のあった場所に出る');
const 見 = p.locator('.dash-m').first().locator('.dash-h');
check('大きい数字の欄がある', (await 見.locator('.dash-p').count()) === 1);
check('金額が入っている', (await 見.locator('.dash-p').innerText()).includes('80,000円'),
  await 見.locator('.dash-p').innerText());
check('何の額かが分かる', (await 見.innerText()).includes('予定回収額'), await 見.innerText());
check('回収の件数も残っている', (await 見.innerText()).includes('1/2 回収'),
  await 見.innerText());
check('未回収額も残っている', (await 見.innerText()).includes('50,000円'),
  await 見.innerText());
await p.locator('.dash-m').first().screenshot({ path: '/tmp/da-1.png' });

console.log('■ 払い終えた回も予定回収額に入っている');
// 1件（30,000円）は入金済み。それでも予定は 80,000円 のまま
check('未回収より予定のほうが大きい', await p.evaluate(() => {
  const h = document.querySelector('.dash-m .dash-h');
  const 数 = (s) => Number((h.innerText.match(s) || [0, '0'])[1].replace(/,/g, ''));
  const 予定 = Number(h.querySelector('.dash-p').innerText.replace(/[^0-9]/g, ''));
  const 未 = 数(/未回収\s*([\d,]+)円/);
  return 予定 === 80000 && 未 === 50000;
}));

console.log('■ 月ごとに出る');
const 月数 = await p.locator('.dash-m').count();
check('3か月ぶん出ている', 月数 === 3, 月数);
const 二 = await p.locator('.dash-m').nth(1).locator('.dash-h').innerText();
check('翌月も予定回収額が出る', 二.includes('80,000円') && 二.includes('予定回収額'), 二);
check('翌月は0/2回収', 二.includes('0/2 回収'), 二);

// ── 今月ぶん ──────────────────────────────
//
// ここが抜けていて不具合を出した。9月17日に見ると、支払日が今日より後の回が
// 落ちて「9月分 20,000円」と出ていた。予定回収額は**その月まるごと**。
console.log('■ 今月は、期日が来たぶんと期日前を並べて出す');
const 今 = p.locator('.dash-m').last().locator('.dash-h');
const 今文 = await 今.innerText();
check('大きい数字は期日の来たぶん',
  (await 今.locator('.dash-p').innerText()).includes('20,000'),
  await 今.locator('.dash-p').innerText());
check('月まるごとの170,000円を大きく出してはいない',
  !(await 今.locator('.dash-p').innerText()).includes('170,000'),
  await 今.locator('.dash-p').innerText());
check('隣に期日前の額が並ぶ', (await 今.locator('.dash-q').count()) === 1);
check('足し算の形になっている',
  (await 今.locator('.dash-q').innerText()).startsWith('＋'),
  await 今.locator('.dash-q').innerText());
check('期日前の額が出る', (await 今.locator('.dash-q').innerText()).includes('150,000円'),
  await 今.locator('.dash-q').innerText());
check('期日前の件数が出る', (await 今.locator('.dash-q').innerText()).includes('3件'),
  await 今.locator('.dash-q').innerText());
check('ひとまとまりで折り返さない', await p.evaluate(() => {
  const q = [...document.querySelectorAll('.dash-m .dash-h .dash-q')].pop();
  return q.getClientRects().length === 1;
}));
check('未回収は期日の来た回だけ', 今文.includes('未回収') && 今文.includes('20,000円'), 今文);
check('足すと月の合計になると書いてある',
  (await 今.locator('.dash-sum').innerText()).includes('170,000円'),
  await 今.locator('.dash-sum').innerText());
check('足されることが分かる',
  (await 今.locator('.dash-sum').innerText()).includes('予定回収額へ足されます'),
  await 今.locator('.dash-sum').innerText());
check('予定＋期日前＝月の合計', await p.evaluate(() => {
  const h = [...document.querySelectorAll('.dash-m .dash-h')].pop();
  const 数 = (s) => Number(s.replace(/[^0-9]/g, ''));
  const 予定 = 数(h.querySelector('.dash-p').innerText);
  const 期日前 = 数(h.querySelector('.dash-q').innerText.replace(/（.*/, ''));
  const 合計 = 数((h.querySelector('.dash-sum').innerText.match(/合計は\s*([\d,]+)円/) || [])[1] || '0');
  return 予定 + 期日前 === 合計;
}));
await p.locator('.dash-m').last().locator('.dash-h').screenshot({ path: '/tmp/da-3.png' });

console.log('■ 期日の全部過ぎた月には、期日前を出さない');
const 先 = p.locator('.dash-m').first().locator('.dash-h');
check('先々月に期日前は出ない', (await 先.locator('.dash-q').count()) === 0,
  await 先.innerText());
check('先々月に足し算の説明は出ない', (await 先.locator('.dash-sum').count()) === 0);

console.log('■ スマホでも横にはみ出さない');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("ダッシュボード")');
await sp.waitForSelector('.dash-m');
await sp.waitForTimeout(700);
check('スマホでも予定回収額が出る',
  (await sp.locator('.dash-m').first().innerText()).includes('予定回収額'));
check('スマホでも％は出ない',
  !/\d+%/.test(await sp.locator('.dash-m').first().innerText()));
check('横にはみ出さない',
  await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await sp.locator('.dash-m').first().screenshot({ path: '/tmp/da-2-sp.png' });

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
