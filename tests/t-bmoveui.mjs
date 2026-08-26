// 顧客編集のボーナス回数と、支払いの記録からの賞与の移動
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

console.log('■ はじめは8回');
check('全48回 + ボーナス8回',
  (await p.locator('.rec-top h3').innerText()).includes('ボーナス8回'),
  await p.locator('.rec-top h3').innerText());

console.log('■ 顧客編集からボーナスの回数を減らす');
await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(500);
const m = p.locator('.modal-box');
const 欄 = m.locator('.f:has(label:text-is("ボーナスの回数（空なら契約の期間ぶん全部）")) input');
check('回数の欄がある', (await 欄.count()) === 1);
check('はじめは実際の回数が出る', (await 欄.inputValue()) === '8', await 欄.inputValue());
check('増減のボタンがある', (await m.locator('.cnt-pick .btn').count()) >= 2);

await m.locator('.cnt-pick .btn', { hasText: '−' }).click();
await p.waitForTimeout(200);
check('−で7になる', (await 欄.inputValue()) === '7', await 欄.inputValue());
await m.locator('.cnt-pick .btn', { hasText: '＋' }).click();
await p.waitForTimeout(200);
check('＋で8に戻る', (await 欄.inputValue()) === '8', await 欄.inputValue());
await 欄.fill('4');
await p.waitForTimeout(300);
check('打ち込みでも変えられる', (await 欄.inputValue()) === '4', await 欄.inputValue());
check('案内に回数が出る',
  (await m.locator('.note.ok').innerText()).includes('4回'),
  await m.locator('.note.ok').innerText());
await p.screenshot({ path: '/tmp/bm-1-edit.png' });

await p.click('.modal-foot .btn-main');
await p.waitForSelector('.modal-box', { state: 'detached', timeout: 15000 });
await p.waitForTimeout(1200);
check('ボーナスが4回になる',
  (await p.locator('.rec-top h3').innerText()).includes('ボーナス4回'),
  await p.locator('.rec-top h3').innerText());

console.log('■ 支払いの記録から、賞与を別の月へ移す');
const 記 = p.locator('.sec', { hasText: '支払いの記録' });
const 前 = await 記.innerText();
check('賞与1は2026年7月', /賞与1\s*07\/27/.test(前), 前.slice(0, 200));
await 記.locator('.rec-tap', { hasText: '賞与1' }).click();
await p.waitForTimeout(400);
check('移す入口がメモの欄の並びに出る',
  (await 記.locator('.rec-add-b button.rec-move:has-text("この賞与を別の月へ移す")').count()) === 1);
check('通常の回には出ない', await (async () => {
  await 記.locator('.rec-tap', { hasText: '1回' }).first().click();
  await p.waitForTimeout(400);
  const n = await 記.locator('.rec-move').count();
  await 記.locator('.rec-tap', { hasText: '賞与1' }).click();
  await p.waitForTimeout(400);
  return n === 0;
})());

await 記.locator('button.rec-move').click();
await p.waitForSelector('.modal-box');
await p.waitForTimeout(400);
const m2 = p.locator('.modal-box');
check('いまの期日と金額が出る',
  (await m2.innerText()).includes('2026/07/27') && (await m2.innerText()).includes('100,000'),
  (await m2.innerText()).slice(0, 200));
check('年月を選ぶ欄がある', (await m2.locator('input[type=month]').count()) === 1);
check('変える前は押せない', await m2.locator('.modal-foot .btn-main').isDisabled());

await m2.locator('input[type=month]').fill('2035-01');
await p.waitForTimeout(300);
check('最終回より後でも移せると分かる',
  (await m2.locator('.note.warn').innerText()).includes('より後になります'),
  await m2.locator('.note.warn').innerText());
check('最終回より後でも押せる', !(await m2.locator('.modal-foot .btn-main').isDisabled()));

await m2.locator('input[type=month]').fill('2020-01');
await p.waitForTimeout(300);
check('契約の初回より前は断る',
  (await m2.locator('.note.warn').innerText()).includes('より前へは移せません'),
  await m2.locator('.note.warn').innerText());
check('前なら押せない', await m2.locator('.modal-foot .btn-main').isDisabled());

await m2.locator('input[type=month]').fill('2026-09');
await p.waitForTimeout(300);
check('移す先を見せる',
  (await m2.locator('.note.warn').innerText()).includes('2026/09/27'),
  await m2.locator('.note.warn').innerText());
await p.screenshot({ path: '/tmp/bm-2-move.png' });
await m2.locator('.modal-foot .btn-main').click();
await p.waitForSelector('.modal-box', { state: 'detached', timeout: 15000 });
await p.waitForTimeout(1200);

const 後 = await 記.innerText();
check('賞与1が9月になる', /賞与1\s*09\/27/.test(後), 後.slice(0, 200));
check('ボーナスの回数は変わらない',
  (await p.locator('.rec-top h3').innerText()).includes('ボーナス4回'),
  await p.locator('.rec-top h3').innerText());
await 記.screenshot({ path: '/tmp/bm-3-after.png' });

console.log('■ スマホでも横にはみ出さない');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("顧客一覧")');
await sp.waitForSelector('tbody tr.clickable');
await sp.click('td:has-text("賞与 太郎")');
await sp.waitForSelector('.rec-top');
await sp.waitForTimeout(800);
await sp.locator('.rec-tap', { hasText: '賞与1' }).click();
await sp.waitForTimeout(400);
await sp.locator('button.rec-move').click();
await sp.waitForSelector('.modal-box');
await sp.waitForTimeout(500);
check('スマホでも開ける', (await sp.locator('.modal-box').count()) === 1);
check('横にはみ出さない',
  await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await sp.screenshot({ path: '/tmp/bm-4-sp.png' });

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
