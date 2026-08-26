// 連帯保証人・緊急連絡先：新規登録で入れる／顧客ページで見える／編集で直せる
import { 開く, 入る, check, 終わる } from './ui.js';

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
const 欄 = (親, 名) => 親.locator(`.f:has(label:text-is("${名}")) input`);
const 選 = (親, 名) => 親.locator(`.f:has(label:text-is("${名}")) select`);

await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');

console.log('■ 顧客ページに、電話が押せる形で出る');
await p.click('td:has-text("保証 太郎")');
await p.waitForSelector('.rec-top');
await p.waitForTimeout(700);
const 枠 = p.locator('.kin');
check('保証人と緊急連絡先の2枠が出る', (await 枠.locator('.kin-c').count()) === 2,
  await 枠.locator('.kin-c').count());
const 文 = await 枠.innerText();
check('見出しが出る', 文.includes('連帯保証人') && 文.includes('緊急連絡先'), 文);
check('名前が出る', 文.includes('保証 花子') && 文.includes('連絡 次郎'), 文);
check('間柄が出る', 文.includes('母') && 文.includes('兄'), 文);
check('住所が出る', 文.includes('福岡県久留米市1-2-3'), 文);
check('電話がかけられる',
  (await 枠.locator('a[href="tel:09011112222"]').count()) === 1);
await 枠.screenshot({ path: '/tmp/kin-1.png' });

console.log('■ 顧客編集から直せる');
await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(600);
const m = p.locator('.modal-box');
check('欄が2つ並ぶ', (await m.locator('.contact').count()) === 2,
  await m.locator('.contact').count());
const 保 = m.locator('.contact', { hasText: '連帯保証人' });
const 緊 = m.locator('.contact', { hasText: '緊急連絡先' });
check('いまの名前が入っている', (await 欄(保, '名前').inputValue()) === '保証 花子',
  await 欄(保, '名前').inputValue());
check('いまの間柄が入っている', (await 選(保, '間柄').inputValue()) === '母',
  await 選(保, '間柄').inputValue());
check('いまの電話番号が入っている',
  (await 欄(保, '電話番号').inputValue()) === '090-1111-2222');
check('いまの住所が入っている',
  (await 欄(保, '住所').inputValue()) === '福岡県久留米市1-2-3');
check('緊急連絡先も入っている', (await 欄(緊, '名前').inputValue()) === '連絡 次郎');
await m.locator('.contact').first().scrollIntoViewIfNeeded();
await p.waitForTimeout(200);
await m.screenshot({ path: '/tmp/kin-2.png' });

await 欄(保, '名前').fill('保証 梅子');
await 選(保, '間柄').selectOption('姉');
await 欄(緊, '住所').fill('佐賀県鳥栖市7-8-9');
await p.click('.modal-foot .btn-main');
await p.waitForSelector('.modal-box', { state: 'detached', timeout: 15000 });
await p.waitForTimeout(1200);
const 後 = await p.locator('.kin').innerText();
check('名前が変わる', 後.includes('保証 梅子'), 後);
check('間柄が変わる', 後.includes('姉'), 後);
check('緊急連絡先の住所が入る', 後.includes('佐賀県鳥栖市7-8-9'), 後);

console.log('■ 新規登録から入れられる');
await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.click('button:has-text("新規顧客登録")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(500);
const n = p.locator('.modal-box');
check('欄が2つ並ぶ', (await n.locator('.contact').count()) === 2);
const 保2 = n.locator('.contact', { hasText: '連帯保証人' });
const 緊2 = n.locator('.contact', { hasText: '緊急連絡先' });
check('はじめは空', (await 欄(保2, '名前').inputValue()) === '');
check('間柄は選ばせる', (await 選(保2, '間柄').count()) === 1);
check('間柄の候補がある', (await 選(保2, '間柄').locator('option').count()) >= 10,
  await 選(保2, '間柄').locator('option').count());

await 欄(n, '名前').first().fill('新規 三郎');
await 欄(n, 'よみ（カナ）').fill('シンキ サブロウ');
await n.locator('.f:has(label:text-is("月々の金額")) input').fill('25000');
await 欄(保2, '名前').fill('新規 保証子');
await 選(保2, '間柄').selectOption('配偶者');
await 欄(保2, '電話番号').fill('070-1234-5678');
await 欄(緊2, '名前').fill('新規 緊急男');
await 選(緊2, '間柄').selectOption('友人');
await n.locator('.contact').first().scrollIntoViewIfNeeded();
await p.waitForTimeout(200);
await n.screenshot({ path: '/tmp/kin-3.png' });

await p.click('.modal-foot .btn-main');
await p.waitForSelector('.modal-box', { state: 'detached', timeout: 15000 });
await p.waitForTimeout(1200);
await p.click('td:has-text("新規 三郎")');
await p.waitForSelector('.rec-top');
await p.waitForTimeout(800);
const 新 = await p.locator('.kin').innerText();
check('登録した保証人が出る', 新.includes('新規 保証子') && 新.includes('配偶者'), 新);
check('登録した緊急連絡先が出る', 新.includes('新規 緊急男') && 新.includes('友人'), 新);

console.log('■ 入れていない人には枠を出さない');
await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.click('button:has-text("新規顧客登録")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(500);
const n2 = p.locator('.modal-box');
await 欄(n2, '名前').first().fill('無記 一郎');
await 欄(n2, 'よみ（カナ）').fill('ムキ イチロウ');
await n2.locator('.f:has(label:text-is("月々の金額")) input').fill('20000');
await p.click('.modal-foot .btn-main');
await p.waitForSelector('.modal-box', { state: 'detached', timeout: 15000 });
await p.waitForTimeout(1200);
await p.click('td:has-text("無記 一郎")');
await p.waitForSelector('.rec-top');
await p.waitForTimeout(800);
check('枠が出ない', (await p.locator('.kin').count()) === 0);

console.log('■ スマホでも横にはみ出さない');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("顧客一覧")');
await sp.waitForSelector('tbody tr.clickable');
await sp.click('td:has-text("保証 太郎")');
await sp.waitForSelector('.rec-top');
await sp.waitForTimeout(800);
check('スマホでも枠が出る', (await sp.locator('.kin .kin-c').count()) === 2);
check('横にはみ出さない',
  await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await sp.screenshot({ path: '/tmp/kin-4-sp.png' });

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
