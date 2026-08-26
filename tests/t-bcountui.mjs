// ボーナスの回数：いまの数を出す／契約に入りきらないときは知らせる
import { 開く, 入る, check, 終わる } from './ui.js';

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.click('td:has-text("賞与 太郎")');
await p.waitForSelector('.rec-top');
await p.waitForTimeout(800);
check('ツリーは賞与7回', (await p.locator('.rec-top h3').innerText()).includes('ボーナス7回'),
  await p.locator('.rec-top h3').innerText());

await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(600);
const m = p.locator('.modal-box');
const 欄 = m.locator('.f:has(label:text-is("ボーナスの回数（空なら契約の期間ぶん全部）")) input');

console.log('■ 開くと、いまの回数が入っている');
check('空ではなく7が入っている', (await 欄.inputValue()) === '7', await 欄.inputValue());
check('案内に「入るのは7回」と出る',
  (await m.locator('.note.ok').innerText()).includes('入るのは 7回'),
  await m.locator('.note.ok').innerText());
check('入りきらない知らせは出ていない', (await m.locator('.note.warn').count()) === 0);
await p.screenshot({ path: '/tmp/bc-1.png' });

console.log('■ 入りきらない回数を入れると知らせる');
await m.locator('.cnt-pick .btn', { hasText: '＋' }).click();
await p.waitForTimeout(300);
check('8になる', (await 欄.inputValue()) === '8', await 欄.inputValue());
const 警 = await m.locator('.note.warn').innerText();
check('入りきらないと知らせる', 警.includes('8回と入れましたが、契約の期間に入るのは 7回まで'), 警);
check('理由が分かる', 警.includes('契約の最終回'), 警);
check('案内は7回のまま',
  (await m.locator('.note.ok').innerText()).includes('7回を作ります'),
  await m.locator('.note.ok').innerText());
await p.screenshot({ path: '/tmp/bc-2.png' });

console.log('■ 「入るだけ」で戻せる');
await m.locator('.cnt-pick .btn', { hasText: '入るだけ' }).click();
await p.waitForTimeout(300);
check('7に戻る', (await 欄.inputValue()) === '7', await 欄.inputValue());
check('知らせが消える', (await m.locator('.note.warn').count()) === 0);

console.log('■ 減らすとその数になる');
await m.locator('.cnt-pick .btn', { hasText: '−' }).click();
await m.locator('.cnt-pick .btn', { hasText: '−' }).click();
await p.waitForTimeout(300);
check('5になる', (await 欄.inputValue()) === '5', await 欄.inputValue());
check('案内が5回ぶんになる',
  (await m.locator('.note.ok').innerText()).includes('古いほうから5回ぶん'),
  await m.locator('.note.ok').innerText());

await p.click('.modal-foot .btn-main');
await p.waitForSelector('.modal-box', { state: 'detached', timeout: 15000 });
await p.waitForTimeout(1200);
check('ツリーが賞与5回になる',
  (await p.locator('.rec-top h3').innerText()).includes('ボーナス5回'),
  await p.locator('.rec-top h3').innerText());

console.log('■ もう一度開くと、5が入っている');
await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(600);
check('5が残る',
  (await p.locator('.modal-box .f:has(label:text-is("ボーナスの回数（空なら契約の期間ぶん全部）")) input')
    .inputValue()) === '5');

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
