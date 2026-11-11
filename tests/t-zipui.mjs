// 郵便番号の画面
//
// 確かめること
//  ・顧客情報に、住所と一緒に郵便番号が出る
//  ・入っていない人は、住所から推定した番号が出る（**推定と分かる形で**）
//  ・顧客情報を編集で、郵便番号を入れられる（住所の左）
//  ・新規顧客登録でも入れられる
import { 開く, 入る, check, 終わる } from './ui.js';

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

const 一覧へ = async () => {
  await p.click('.tab:has-text("顧客一覧")');
  await p.waitForSelector('tbody tr.clickable');
  await p.waitForTimeout(800);
};
const 開く人 = async (名) => {
  await 一覧へ();
  await p.locator('tbody tr.clickable', { hasText: 名 }).locator('td.nm b').click();
  await p.waitForSelector('.rec-top');
  await p.waitForTimeout(800);
};

// ── 入れてある人 ─────────────────────────────
console.log('■ 入れてある郵便番号が、住所と一緒に出る');
await 開く人('アオキ 一郎');
const 住 = p.locator('.cust-sub .addr');
check('住所の欄がある', (await 住.count()) === 1);
check('〒が付いて出る', (await 住.innerText()).includes('〒830-0032'), await 住.innerText());
check('住所も一緒に出る', (await 住.innerText()).includes('福岡県久留米市東町1-1'),
  await 住.innerText());
check('ひとかたまりで出る（住所と離れていない）',
  (await 住.innerText()).replace(/\s+/g, ' ').trim() === '〒830-0032 福岡県久留米市東町1-1',
  await 住.innerText());
check('推定の印は付かない', (await p.locator('.cust-sub .zip-g').count()) === 0);
await p.locator('.cust-sub').screenshot({ path: '/tmp/zip-1.png' });

// ── 入っていない人（住所から推定） ─────────────────
console.log('■ 入っていない人は、住所から推定した番号が出る');
await 開く人('カワダ 二郎');
const 推 = p.locator('.cust-sub .zip-g');
check('推定の番号が出る', (await 推.innerText()).includes('〒100-0001'), await 推.innerText());
check('「推定」と分かる印が付く', (await 推.locator('i').innerText()) === '推定',
  await 推.locator('i').innerText());
check('入れてもらった番号とは色を変える（薄くする）',
  await p.evaluate(() => getComputedStyle(document.querySelector('.cust-sub .zip-g')).color)
    !== await p.evaluate(() => getComputedStyle(document.querySelector('.cust-sub')).color));
check('なぜ推定かを説明してある',
  /住所から推定/.test(await 推.getAttribute('title') || ''), await 推.getAttribute('title'));
check('どこまで当たったかも書いてある',
  /町域まで一致/.test(await 推.getAttribute('title') || ''), await 推.getAttribute('title'));
await p.locator('.cust-sub').screenshot({ path: '/tmp/zip-2.png' });

console.log('■ 編集では、郵便番号は住所の左にある');
await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(700);
const m = p.locator('.modal-box');
const 欄 = m.locator('.grid-zip');
check('郵便番号と住所がひと並びにある', (await 欄.count()) === 1);
check('郵便番号が左', await p.evaluate(() => {
  const f = [...document.querySelectorAll('.grid-zip .f label')].map((e) => e.innerText);
  return f[0] === '郵便番号' && f[1] === '住所';
}), await p.evaluate(() =>
  [...document.querySelectorAll('.grid-zip .f label')].map((e) => e.innerText)));
const 郵欄 = m.locator('.grid-zip .f', { has: p.locator('label:text-is("郵便番号")') });
check('空のまま出る（推定は入力ではない）',
  (await 郵欄.locator('input').inputValue()) === '', await 郵欄.locator('input').inputValue());
const 説明 = m.locator('.zip-hint');
check('推定した番号を、欄の下の1行で知らせる',
  (await 説明.innerText()).includes('〒100-0001'), await 説明.innerText());

console.log('■ 推定した番号を、ひと押しで入れられる');
await 説明.locator('.zip-take').click();
await p.waitForTimeout(300);
check('欄に入る', (await 郵欄.locator('input').inputValue()) === '100-0001',
  await 郵欄.locator('input').inputValue());
await p.click('.modal-box button:has-text("保存する")');
await p.waitForTimeout(1800);
check('入力として出る（推定の印が消える）',
  (await p.locator('.cust-sub .zip-g').count()) === 0
  && (await p.locator('.cust-sub .addr').innerText()).includes('〒100-0001'),
  await p.locator('.cust-sub .addr').innerText());

console.log('■ 空にすると、また推定に戻る');
await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(700);
await p.locator('.modal-box .grid-zip .f', { has: p.locator('label:text-is("郵便番号")') })
  .locator('input').fill('');
await p.click('.modal-box button:has-text("保存する")');
await p.waitForTimeout(1800);
check('推定の印が戻る', (await p.locator('.cust-sub .zip-g').count()) === 1);
check('番号も同じ', (await p.locator('.cust-sub .zip-g').innerText()).includes('〒100-0001'),
  await p.locator('.cust-sub .zip-g').innerText());

console.log('■ 全角で打っても入る');
await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(700);
await p.locator('.modal-box .grid-zip .f', { has: p.locator('label:text-is("郵便番号")') })
  .locator('input').fill('〒１００−００１３');
await p.click('.modal-box button:has-text("保存する")');
await p.waitForTimeout(1800);
check('123-4567 の形になる',
  (await p.locator('.cust-sub .addr').innerText()).includes('〒100-0013'),
  await p.locator('.cust-sub .addr').innerText());

console.log('■ 7桁にならないと、断って理由を出す');
await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(700);
await p.locator('.modal-box .grid-zip .f', { has: p.locator('label:text-is("郵便番号")') })
  .locator('input').fill('123');
await p.click('.modal-box button:has-text("保存する")');
await p.waitForTimeout(1200);
check('モーダルは開いたまま', (await p.locator('.modal-box').count()) === 1);
check('7桁でと言う', /7桁/.test(await p.locator('.modal-box').innerText()),
  (await p.locator('.modal-box').innerText()).slice(0, 200));
await p.locator('.modal-box').screenshot({ path: '/tmp/zip-3.png' });
await p.click('.modal-box button:has-text("キャンセル")');
await p.waitForTimeout(500);

// ── 町域まで決まらない人 ────────────────────────
console.log('■ 町域まで決まらない住所は、市区町村までと断る');
await 開く人('タナカ 四郎');
const 四 = p.locator('.cust-sub .zip-g');
check('市区町村の番号が出る', (await 四.innerText()).includes('〒604-0000'), await 四.innerText());
check('どこまでかを書いてある',
  /市区町村まで一致/.test(await 四.getAttribute('title') || ''), await 四.getAttribute('title'));

// ── 住所も番号も無い人 ─────────────────────────
console.log('■ どちらも無ければ、何も出さない');
await 開く人('サトウ 三郎');
check('住所の欄が出ない', (await p.locator('.cust-sub .addr').count()) === 0);
check('〒も出ない', !(await p.locator('.cust-sub').innerText()).includes('〒'),
  await p.locator('.cust-sub').innerText());

// ── 新規顧客登録 ───────────────────────────
console.log('■ 新規顧客登録でも入れられる');
await 一覧へ();
await p.click('button:has-text("新規顧客登録")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(700);
check('郵便番号の欄がある',
  (await p.locator('.modal-box .grid-zip .f label').first().innerText()) === '郵便番号',
  await p.locator('.modal-box .grid-zip .f label').first().innerText());
check('空でよいと書いてある',
  (await p.locator('.modal-box .zip-hint').innerText()).includes('空のままでもかまいません'),
  await p.locator('.modal-box .zip-hint').innerText());
const 新郵 = p.locator('.modal-box .grid-zip .f', { has: p.locator('label:text-is("郵便番号")') });
await 新郵.locator('input').fill('9000006');
await p.locator('.modal-box .grid-zip .f', { has: p.locator('label:text-is("住所")') })
  .locator('input').fill('沖縄県那覇市おもろまち1-1-1');
// 「名前」は連帯保証人などにもあるので、いちばん上（本人）を掴む
await p.locator('.modal-box .f', { has: p.locator('label:text-is("名前")') })
  .first().locator('input').fill('ユウビン 五郎');
await p.locator('.modal-box .f', { has: p.locator('label:text-is("月々の金額")') })
  .first().locator('input').fill('20000');
await p.click('.modal-box button:has-text("登録する")');
await p.waitForTimeout(2000);
await 開く人('ユウビン 五郎');
check('入れた番号が出る',
  (await p.locator('.cust-sub .addr').innerText()).includes('〒900-0006'),
  await p.locator('.cust-sub .addr').innerText());

console.log('■ スマホでも横にはみ出さない');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("顧客一覧")');
await sp.waitForSelector('tbody tr.clickable');
await sp.waitForTimeout(800);
// 四郎は番号を入れていない（二郎は上の検査でもう入れてある）
await sp.locator('tbody tr.clickable', { hasText: 'タナカ 四郎' }).locator('td.nm b').click();
await sp.waitForSelector('.rec-top');
await sp.waitForTimeout(800);
check('推定の郵便番号が出る', (await sp.locator('.cust-sub .zip-g').count()) === 1,
  await sp.locator('.cust-sub').innerText());
check('横にはみ出さない',
  await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await sp.click('button:has-text("顧客情報を編集")');
await sp.waitForSelector('.modal-box');
await sp.waitForTimeout(700);
check('編集でも横にはみ出さない',
  await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
check('スマホでは郵便番号と住所を上下に積む', await sp.evaluate(() => {
  const f = [...document.querySelectorAll('.grid-zip .f')];
  return f.length === 2
    && f[0].getBoundingClientRect().bottom <= f[1].getBoundingClientRect().top + 1;
}));
await sp.screenshot({ path: '/tmp/zip-4-sp.png' });

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
