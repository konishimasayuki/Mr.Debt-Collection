// 顧客一覧の残債金額の総額（引き上げは入れない）
import { 開く, 入る, check, 終わる } from './ui.js';

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.waitForTimeout(500);
const 総 = p.locator('.sum-row');

console.log('■ 見出しの行と1行目のあいだに出る');
check('総額の行がある', (await 総.count()) === 1);
check('見出しのすぐ下にある', await p.evaluate(() => {
  const t = document.querySelector('.cards table');
  const 見 = t.querySelector('thead');
  const 総 = t.querySelector('.sum-row');
  const 初 = t.querySelector('tbody tr.clickable');
  if (!見 || !総 || !初) return false;
  const y = (e) => e.getBoundingClientRect().top;
  return y(見) < y(総) && y(総) < y(初);
}));
check('名前が出ている', (await 総.innerText()).includes('残債金額の総額'),
  await 総.innerText());

console.log('■ 引き上げの分は足さない');
// 300,000（アイダ）＋ 170,000（カワダ）＋ 0（完済のタナカ）＝ 470,000
// サトウの 500,000 は引き上げなので入れない
check('総額は470,000円', (await 総.innerText()).includes('470,000'), await 総.innerText());
check('引き上げを足していない', !(await 総.innerText()).includes('970,000'),
  await 総.innerText());
check('人数が出る', (await 総.innerText()).includes('3名ぶん'), await 総.innerText());
check('除いたことが分かる', (await 総.innerText()).includes('引き上げ 1名は除く'),
  await 総.innerText());
await p.locator('.cards').screenshot({ path: '/tmp/sum-1.png' });

console.log('■ 検索で絞ると、絞ったぶんの総額になる');
await p.locator('.search').fill('アイダ');
await p.waitForTimeout(500);
check('300,000円になる', (await 総.innerText()).includes('300,000'), await 総.innerText());
check('1名ぶんになる', (await 総.innerText()).includes('1名ぶん'), await 総.innerText());
check('引き上げの断りは出ない', !(await 総.innerText()).includes('引き上げ'),
  await 総.innerText());

await p.locator('.search').fill('サトウ');
await p.waitForTimeout(500);
check('引き上げだけなら0円', (await 総.innerText()).includes('0円'), await 総.innerText());
check('0名ぶんになる', (await 総.innerText()).includes('0名ぶん'), await 総.innerText());

await p.locator('.search').fill('');
await p.waitForTimeout(500);
check('戻すと470,000円', (await 総.innerText()).includes('470,000'), await 総.innerText());

console.log('■ 誰も出ないときは総額も出さない');
await p.locator('.search').fill('いない人');
await p.waitForTimeout(500);
check('総額の行が消える', (await 総.count()) === 0);
await p.locator('.search').fill('');
await p.waitForTimeout(500);

console.log('■ スマホでも読める');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("顧客一覧")');
await sp.waitForSelector('tbody tr.clickable');
await sp.waitForTimeout(600);
const 総2 = sp.locator('.sum-row');
check('スマホでも出る', (await 総2.count()) === 1);
check('スマホでも470,000円', (await 総2.innerText()).includes('470,000'),
  await 総2.innerText());
check('1行目より上にある', await sp.evaluate(() => {
  const y = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top : 0; };
  return y('.sum-row') < y('tbody tr.clickable');
}));
check('横にはみ出さない',
  await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await sp.screenshot({ path: '/tmp/sum-2-sp.png' });

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
