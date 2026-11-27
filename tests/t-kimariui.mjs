// 金額の決まりの画面（kimari-seed.mjs の土台で走らせる）
//   新規登録で決める／顧客ページで中身が見える／顧客編集で決め直す
import { 開く, 入る, check, 終わる } from './ui.js';

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

// 台帳から支払予定を読む（画面の数字の確かめに使う）
const 予定 = async (名) => p.evaluate(async (名) => {
  const l = await (await fetch('/api/customers')).json();
  const x = l.顧客.find((r) => r.氏名 === 名);
  const d = await (await fetch('/api/customer?id=' + x.id)).json();
  return { 額: d.支払予定.filter((s) => s.種類 === '通常').map((s) => s.請求), 総額: d.顧客.支払総額 };
}, 名);
const 欄 = (scope, 名) => scope.locator('.f', { has: p.locator(`label:text-is("${名}")`) }).first().locator('input');

console.log('■ 新規登録で、偶数回・奇数回・最終回の額を決められる（回の番号で数える）');
await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.click('button:has-text("新規顧客登録")');
await p.waitForSelector('.modal-box .kimari');
const m = p.locator('.modal-box');
await 欄(m, '名前').fill('カワダ 二郎');
await 欄(m, '月々の金額').fill('30000');
await 欄(m, '支払回数').fill('6');
await 欄(m, '毎月の支払日').fill('10');
await 欄(m, '支払い開始月').fill('2027-02');   // 2月始まり：1回目は2月でも奇数回
await 欄(m, '偶数回の金額').fill('40000');
await 欄(m, '最終回の金額').fill('10000');
await p.waitForTimeout(300);
const 見込み = await m.locator('[data-k="金額の見込み"]').innerText();
check('見込みに回ごとの額が出る（2回目は3月でも偶数回で40,000）', /2回\s*3月\s*40,000/.test(見込み), 見込み);
check('1回目は2月でも奇数回（決まりが無いので30,000）', /1回\s*2月\s*30,000/.test(見込み), 見込み);
check('最終回は10,000', /6回\s*7月\s*10,000/.test(見込み), 見込み);
check('月額の回の合計 180,000円', (await m.locator('[data-k="予定の合計"]').innerText()) === '180,000円',
  await m.locator('[data-k="予定の合計"]').innerText());
check('支払総額の見込みも決まりどおり', (await m.locator('.note, [class*="note"]').last().innerText()).includes('180,000円'),
  await m.locator('.note, [class*="note"]').last().innerText());
await p.locator('.modal-box').screenshot({ path: '/tmp/kimari-1.png' });
await p.click('.modal-box button:has-text("登録する")');
await p.waitForTimeout(1500);
let 実 = await 予定('カワダ 二郎');
check('登録した予定が決まりどおり', JSON.stringify(実.額) === '[30000,40000,30000,40000,30000,10000]', 実.額);
check('支払総額 180,000円', 実.総額 === 180000, 実.総額);

console.log('■ 顧客ページで、決まりの中身が見える');
await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.waitForTimeout(500);
await p.locator('tbody tr.clickable', { hasText: 'アオキ 一郎' }).locator('td.nm b').click();
await p.waitForSelector('.rec-top');
await p.waitForTimeout(600);
const 中身 = await p.locator('[data-k="決まりの中身"]').innerText();
check('偶数回と最終回の額を添える', 中身.includes('偶数回 40,000円') && 中身.includes('最終回 10,000円'), 中身);

console.log('■ 顧客編集で決め直せる（払った回は動かない）');
await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box [data-k="金額の決まりの欄"]');
const e = p.locator('.modal-box [data-k="金額の決まりの欄"]');
check('いまの決まりが入っている', (await 欄(e, '偶数回の金額').inputValue()) === '40,000',
  await 欄(e, '偶数回の金額').inputValue());
await 欄(e, '奇数回の金額').fill('25000');
await p.waitForTimeout(300);
const 見2 = await e.locator('[data-k="金額の見込み"]').innerText();
check('払った1回目はいまの額のまま（30,000）', /1回\s*1月\s*30,000/.test(見2), 見2);
check('3回目（3月）は25,000になる見込み', /3回\s*3月\s*25,000/.test(見2), 見2);
check('払った回は色を変える', (await e.locator('.kimari-p span.paid').count()) === 1);
check('何から何へ変えるかを出す', (await e.innerText()).includes('奇数回 25,000円'), await e.innerText());
await e.screenshot({ path: '/tmp/kimari-2.png' });

console.log('■ 理由が無いと保存しない');
await p.click('.modal-box button:has-text("保存する")');
await p.waitForTimeout(600);
check('モーダルは開いたまま', (await p.locator('.modal-box').count()) === 1);
check('理由を求める', (await p.locator('.modal-box').innerText()).includes('変更の理由を書いてください'));

await 欄(e, '変更の理由（変えるなら必ず）').fill('奇数回は少なめにすると本人と合意');
await p.click('.modal-box button:has-text("保存する")');
await p.waitForTimeout(1800);
check('保存できる', (await p.locator('.modal-box').count()) === 0);
実 = await 予定('アオキ 一郎');
check('1回目（払った）は30,000のまま／3・5回目が25,000',
  JSON.stringify(実.額) === '[30000,40000,25000,40000,25000,10000]', 実.額);
check('支払総額も変わる', 実.総額 === 170000, 実.総額);
check('顧客ページの添え書きも変わる',
  (await p.locator('[data-k="決まりの中身"]').innerText()).includes('奇数回 25,000円'),
  await p.locator('[data-k="決まりの中身"]').innerText());
check('支払いの記録にメモが残る', (await p.locator('main').innerText()).includes('支払い金額の決まりを変更'));

console.log('■ 決まりを変えなければ、ほかの欄だけ保存できる（理由は要らない）');
await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box');
await 欄(p.locator('.modal-box'), '車種').fill('ムーヴ');
await p.click('.modal-box button:has-text("保存する")');
await p.waitForTimeout(1500);
check('保存できる', (await p.locator('.modal-box').count()) === 0);
check('金額は変わらない', JSON.stringify((await 予定('アオキ 一郎')).額) === '[30000,40000,25000,40000,25000,10000]');

console.log('■ スマホでも横にはみ出さない');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("顧客一覧")');
await sp.waitForSelector('tbody tr.clickable');
await sp.click('button:has-text("新規顧客登録")');
await sp.waitForSelector('.modal-box .kimari');
check('新規登録', await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
