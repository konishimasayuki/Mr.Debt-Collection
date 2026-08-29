// 支払いの記録の未払いの回から、その回から先の金額を変える
import { 開く, 入る, check, 終わる } from './ui.js';

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.click('td:has-text("額変 太郎")');
await p.waitForSelector('.rec-top');
await p.waitForTimeout(800);
const 記 = p.locator('.sec', { hasText: '支払いの記録' });

console.log('■ 入金の入った回には出さない');
await 記.locator('.rec-tap', { hasText: '1回' }).first().click();
await p.waitForTimeout(400);
check('1回目には出ない', (await 記.locator('button.rec-amt').count()) === 0);

console.log('■ 未払いの回を押すと出る');
await 記.locator('.rec-tap', { hasText: '3回' }).first().click();
await p.waitForTimeout(400);
check('メモの並びに出る',
  (await 記.locator('.rec-add-b button.rec-amt:has-text("この回から先の金額を変える")')
    .count()) === 1);

await 記.locator('button.rec-amt').click();
await p.waitForSelector('.modal-box');
await p.waitForTimeout(400);
const m = p.locator('.modal-box');
check('見出しにその回が出る', (await m.locator('h3, .modal-head').innerText())
  .includes('3回目から先'), await m.innerText().then((x) => x.slice(0, 80)));
const 文 = await m.innerText();
check('変える回数を出す', 文.includes('8回'), 文.slice(0, 300));
check('払い終えた回は動かないと書いてある', 文.includes('払い終えた回は1円も動きません'), 文);
check('いまの金額を出す', 文.includes('30,000'), 文.slice(0, 300));
check('変える前は押せない', await m.locator('.modal-foot .btn-main').isDisabled());

console.log('■ 金額を入れると、総額と残債の変わり方を出す');
await m.locator('.f:has(label:text-is("新しい金額（1回あたり）")) input').fill('20000');
await p.waitForTimeout(400);
const 知 = await m.locator('.note.warn').innerText();
check('前後の金額を出す', 知.includes('30,000円 → 20,000円'), 知);
check('減る額を出す', 知.includes('10,000円 減る'), 知);
check('支払総額の変わり方を出す', 知.includes('300,000円 → 220,000円'), 知);
check('残債の変わり方を出す', 知.includes('240,000円 → 160,000円'), 知);
check('理由が無いうちは押せない', await m.locator('.modal-foot .btn-main').isDisabled());
await p.screenshot({ path: '/tmp/amt-1.png' });

await m.locator('.f:has(label:text-is("変更の理由（必ず書いてください）")) input')
  .fill('収入が減ったため、来月から2万円に下げると本人と合意');
await p.waitForTimeout(300);
check('理由を書けば押せる', !(await m.locator('.modal-foot .btn-main').isDisabled()));
await m.locator('.modal-foot .btn-main').click();
await p.waitForSelector('.modal-box', { state: 'detached', timeout: 15000 });
await p.waitForTimeout(1400);

console.log('■ 支払いの記録と数字が合う');
const 後 = await 記.innerText();
check('1・2回目は30,000円のまま', /1回\s*09\/27\s*30,000/.test(後), 後.slice(0, 200));
check('3回目から20,000円', /3回\s*11\/27\s*20,000/.test(後), 後.slice(0, 300));
check('10回目も20,000円', /10回\s*06\/27\s*20,000/.test(後), 後.slice(-200));
const 数 = await p.locator('.strip').innerText();
check('月々の金額が20,000円になる', 数.includes('20,000円'), 数);
check('残債が160,000円になる', 数.includes('160,000円'), 数);
await 記.screenshot({ path: '/tmp/amt-2.png' });

console.log('■ 理由が支払いの記録に残る');
await 記.locator('.rec-tap', { hasText: '3回' }).first().click();
await p.waitForTimeout(500);
const メ = await 記.innerText();
check('前後の金額が読める', メ.includes('30,000円 → 20,000円'), メ.slice(0, 600));
check('理由が読める', メ.includes('収入が減ったため'), メ.slice(0, 600));

console.log('■ 変えたあとの回からも、また変えられる');
await 記.locator('.rec-tap', { hasText: '8回' }).first().click();
await p.waitForTimeout(400);
await 記.locator('button.rec-amt').click();
await p.waitForSelector('.modal-box');
await p.waitForTimeout(400);
const m2 = p.locator('.modal-box');
check('いまの金額は20,000円', (await m2.innerText()).includes('20,000'),
  (await m2.innerText()).slice(0, 300));
check('変える回数は3回', (await m2.innerText()).includes('3回'),
  (await m2.innerText()).slice(0, 300));
await m2.locator('.f:has(label:text-is("新しい金額（1回あたり）")) input').fill('50000');
await m2.locator('.f:has(label:text-is("変更の理由（必ず書いてください）")) input')
  .fill('本人の希望で早く終わらせる');
await p.waitForTimeout(300);
check('上げると増えると出る',
  (await m2.locator('.note.warn').innerText()).includes('30,000円 増える'),
  await m2.locator('.note.warn').innerText());
await m2.locator('.modal-foot .btn-main').click();
await p.waitForSelector('.modal-box', { state: 'detached', timeout: 15000 });
await p.waitForTimeout(1400);
const 後2 = await 記.innerText();
check('7回目は20,000円のまま', /7回\s*03\/27\s*20,000/.test(後2), 後2.slice(0, 400));
check('8回目から50,000円', /8回\s*04\/27\s*50,000/.test(後2), 後2.slice(-300));

console.log('■ スマホでも横にはみ出さない');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("顧客一覧")');
await sp.waitForSelector('tbody tr.clickable');
await sp.click('td:has-text("額変 太郎")');
await sp.waitForSelector('.rec-top');
await sp.waitForTimeout(800);
await sp.locator('.rec-tap', { hasText: '5回' }).first().click();
await sp.waitForTimeout(400);
await sp.locator('button.rec-amt').click();
await sp.waitForSelector('.modal-box');
await sp.waitForTimeout(500);
check('スマホでも開ける', (await sp.locator('.modal-box').count()) === 1);
check('横にはみ出さない',
  await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await sp.screenshot({ path: '/tmp/amt-3-sp.png' });

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
