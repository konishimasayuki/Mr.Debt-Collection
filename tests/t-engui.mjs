// エンジンストップ（取引の状態）の画面検査
//
// 確かめること
//  ・顧客情報を編集を押したら、いちばん上に「取引の状態」が出る
//  ・状態は 通常 / エンジンストップ / 車両引き上げ の3つ
//  ・エンジンストップの方は、顧客一覧の**目印の下**に並ぶ
//  ・エンジンストップは終わりではない（未入金にも出る。完済/引き上げには出ない）
import { 開く, 入る, check, 終わる } from './ui.js';

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

const 一覧へ = async () => {
  await p.click('.tab:has-text("顧客一覧")');
  await p.waitForSelector('tbody tr.clickable');
  await p.waitForTimeout(900);
};

// ── 顧客一覧 ───────────────────────────────
await 一覧へ();
console.log('■ 目印の下に、エンジンストップの欄が出る');
const 停 = p.locator('.eng-list');
check('欄がある', (await 停.count()) === 1);
check('見出しが出る', (await 停.innerText()).includes('エンジンストップ'), await 停.innerText());
check('1名出ている', (await 停.locator('.pin-c').count()) === 1,
  await 停.locator('.pin-c').count());
check('名前が出る', (await 停.innerText()).includes('カワダ 二郎'), await 停.innerText());
check('残債が出る', (await 停.innerText()).includes('残債'), await 停.innerText());
check('取引は続いていると書いてある',
  (await 停.innerText()).includes('取引は続いています'), await 停.innerText());
check('引き上げた方は混ざらない',
  !(await 停.innerText()).includes('タナカ 四郎'), await 停.innerText());
check('目印の欄より下にある', await p.evaluate(() => {
  const y = (s) => document.querySelector(s).getBoundingClientRect().top;
  return y('.pin:not(.eng-list)') < y('.eng-list');
}));
check('索引より上にある', await p.evaluate(() => {
  const y = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top : 1e9; };
  return y('.eng-list') < y('.idx');
}));
check('目印の人は混ざらない',
  !(await 停.innerText()).includes('アオキ 一郎'), await 停.innerText());

console.log('■ 一覧の行にも印が出る');
const 二郎の行 = p.locator('tbody tr.clickable', { hasText: 'カワダ 二郎' });
check('行に印が1つ', (await 二郎の行.locator('.tag.t-eng').count()) === 1);
check('行は薄いグレーにしない（終わった取引ではない）',
  !(await 二郎の行.getAttribute('class')).includes('taken-row'),
  await 二郎の行.getAttribute('class'));
check('ほかの人には印が出ない',
  (await p.locator('tbody tr.clickable .tag.t-eng').count()) === 1,
  await p.locator('tbody tr.clickable .tag.t-eng').count());
await p.screenshot({ path: '/tmp/eng-list.png' });

// ── 顧客ページ ──────────────────────────────
console.log('■ 顧客ページの上にも出る');
await 停.locator('.pin-n').click();
await p.waitForSelector('.rec-top');
await p.waitForTimeout(900);
check('二郎のページが開く',
  (await p.locator('.cust-name').innerText()).includes('カワダ 二郎'),
  await p.locator('.cust-name').innerText());
check('エンジンストップのタイルが出る', (await p.locator('.strip .s.eng').count()) === 1);
check('止めた日が出る', /\d+月\d+日 に停止/.test(await p.locator('.strip .s.eng').innerText()),
  await p.locator('.strip .s.eng').innerText());
check('取引は続いていると書いてある',
  (await p.locator('.strip .s.eng').innerText()).includes('取引は続いています'));
check('引き上げのタイルは出ない', (await p.locator('.strip .s.taken').count()) === 0);
await p.locator('.strip').screenshot({ path: '/tmp/eng-strip.png' });

// ── 顧客情報を編集 ─────────────────────────────
console.log('■ 編集のいちばん上が、取引の状態');
await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(800);
const m = p.locator('.modal-box');
const 先頭 = m.locator('.f').first();
check('いちばん上の欄が取引の状態',
  (await 先頭.locator('label').first().innerText()).includes('取引の状態'),
  await 先頭.locator('label').first().innerText());
const 札 = m.locator('.dbt-pick .dbt-o');
check('札が3つ', (await 札.count()) === 3, await 札.count());
const 札の文 = await 札.allInnerTexts();
check('通常がある', 札の文.some((t) => t.startsWith('通常')), 札の文);
check('エンジンストップがある', 札の文.some((t) => t.startsWith('エンジンストップ')), 札の文);
check('車両引き上げがある', 札の文.some((t) => t.startsWith('車両引き上げ')), 札の文);
check('「回収」とは出さない（画面の呼び名は車両引き上げ）',
  !札の文.join('').includes('回収'), 札の文);
check('いまの状態が選ばれている',
  (await m.locator('.dbt-o.stop').getAttribute('class')).includes('on'),
  await m.locator('.dbt-o.stop').getAttribute('class'));
check('止めた日の欄が出る', (await m.locator('label:has-text("止めた日")').count()) === 1);
check('取引は続くと書いてある',
  (await m.innerText()).includes('未入金タブにもダッシュボードにも'), '');
await m.screenshot({ path: '/tmp/eng-edit.png' });

console.log('■ 通常に戻せる');
await m.locator('.dbt-o', { hasText: '通常' }).click();
await p.waitForTimeout(400);
check('止めた日の欄が消える', (await m.locator('label:has-text("止めた日")').count()) === 0);
await p.click('.modal-box button:has-text("保存する")');
await p.waitForTimeout(1800);
check('タイルが消える', (await p.locator('.strip .s.eng').count()) === 0);
await 一覧へ();
check('一覧の欄も消える', (await p.locator('.eng-list').count()) === 0);
check('行の印も消える', (await p.locator('tbody tr.clickable .tag.t-eng').count()) === 0);
check('顧客は残っている（消えてはいない）',
  (await p.locator('tbody tr.clickable', { hasText: 'カワダ 二郎' }).count()) === 1);

console.log('■ 画面からエンジンストップにできる');
await p.locator('tbody tr.clickable', { hasText: 'カワダ 二郎' }).locator('td.nm b').click();
await p.waitForSelector('.rec-top');
await p.waitForTimeout(900);
await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(700);
await p.locator('.modal-box .dbt-o.stop').click();
await p.waitForTimeout(400);
check('止めた日に今日が入る',
  /^\d{4}-\d{2}-\d{2}$/.test(await p.locator('.modal-box input[type="date"]').first().inputValue()),
  await p.locator('.modal-box input[type="date"]').first().inputValue());
await p.click('.modal-box button:has-text("保存する")');
await p.waitForTimeout(1800);
check('タイルが戻る', (await p.locator('.strip .s.eng').count()) === 1);
await 一覧へ();
check('一覧の欄も戻る', (await p.locator('.eng-list .pin-c').count()) === 1,
  await p.locator('.eng-list .pin-c').count());

// ── 終わった取引ではない ───────────────────────
console.log('■ エンジンストップは終わりではない');
await p.click('.tab:has-text("未入金")');
await p.waitForSelector('.unpaid-cards');
await p.waitForTimeout(900);
check('未入金に出ている',
  (await p.locator('.unpaid-cards tbody tr', { hasText: 'カワダ 二郎' }).count()) >= 1,
  await p.locator('.unpaid-cards tbody').innerText());
await p.click('.tab:has-text("完済/引き上げ")');
await p.waitForSelector('.cards');
await p.waitForTimeout(900);
check('完済/引き上げには出ていない',
  (await p.locator('tbody tr', { hasText: 'カワダ 二郎' }).count()) === 0,
  await p.locator('tbody').innerText());
check('引き上げた四郎はこちらに出る',
  (await p.locator('tbody tr', { hasText: 'タナカ 四郎' }).count()) === 1);

console.log('■ 検索しているあいだは欄を出さない');
await 一覧へ();
await p.locator('.search').first().fill('アオキ');
await p.waitForTimeout(500);
check('欄が消える', (await p.locator('.eng-list').count()) === 0);
await p.locator('.search').first().fill('');
await p.waitForTimeout(500);
check('戻ると出る', (await p.locator('.eng-list').count()) === 1);

console.log('■ スマホでも横にはみ出さない');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("顧客一覧")');
await sp.waitForSelector('tbody tr.clickable');
await sp.waitForTimeout(900);
check('欄が出る', (await sp.locator('.eng-list').count()) === 1);
check('横にはみ出さない',
  await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await sp.screenshot({ path: '/tmp/eng-sp.png' });

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
