// 計算タブ。顧客を選ぶと買戻し金額と将来利益を出す
//   買戻し金額 ＝（契約金額 − 支払済金額）× 75%
//   将来利益   ＝ 契約金額 − 契約金額の75%
import { 開く, 入る, check, 終わる } from './ui.js';

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

console.log('■ 設定の左に「計算」タブがある');
const タブ = await p.locator('.tabs .tab').allInnerTexts();
check('計算タブがある', タブ.includes('計算'), タブ);
check('設定のすぐ左', タブ.indexOf('計算') === タブ.indexOf('設定') - 1, タブ);

await p.click('.tab:has-text("計算")');
await p.waitForSelector('.calc-c');
await p.waitForTimeout(500);
check('選ぶまでは案内だけ', (await p.locator('.calc-out').innerText()).includes('顧客を選んでください'));
check('顧客が並ぶ', (await p.locator('.calc-c').count()) === 4, await p.locator('.calc-c').count());

const 選ぶ = async (名) => {
  await p.locator('.calc-c', { hasText: 名 }).click();
  await p.waitForSelector('.calc-a');
  await p.waitForTimeout(400);
};
const 値 = async (k) => (await p.locator(`.calc-a[data-k="${k}"]`).innerText()).trim();
const 表 = async () => p.locator('.calc-t').innerText();

console.log('■ 画像の計算例（契約1,700,000円 / 支払済300,000円 / 譲渡先MIAMI）');
await 選ぶ('エンドウ 五郎');
const 外 = async () => p.locator('.calc-out').innerText();
check('契約金額', (await 表()).includes('1,700,000円'), await 表());
check('お客様の支払済金額', (await 表()).includes('300,000円'), await 表());
check('未払い残債 1,400,000円', (await 表()).includes('1,400,000円'), await 表());
check('手数料 75%（買戻し率ではない）', (await 表()).includes('手数料') && (await 表()).includes('75%')
  && !(await 外()).includes('買戻し率'), await 表());
check('買戻し金額 1,050,000円', (await 値('買戻し金額')) === '1,050,000円', await 値('買戻し金額'));
check('MIAMIへの買戻し金額と出る', (await 外()).includes('MIAMIへの買戻し金額'), await 外());
check('式が見える', (await 外()).includes('（契約金額 − 支払済金額）× 手数料'), await 外());
check('掛け算も見える', (await 外()).includes('1,400,000円 × 75% ＝ 1,050,000円'), await 外());
check('将来利益 425,000円', (await 値('将来利益')) === '425,000円', await 値('将来利益'));
await p.screenshot({ path: '/tmp/calc-1.png' });

console.log('■ アオキ 一郎（720,000円 / 90,000円入金・譲渡先なし）');
await 選ぶ('アオキ 一郎');
check('名前が出る', (await p.locator('.calc-name').innerText()) === 'アオキ 一郎');
check('未払い残債 630,000円', (await 表()).includes('630,000円'), await 表());
check('買戻し金額 472,500円', (await 値('買戻し金額')) === '472,500円', await 値('買戻し金額'));
check('譲渡先が無ければ「買戻し金額」だけ', !(await 外()).includes('への買戻し金額'), await 外());
check('将来利益 180,000円', (await 値('将来利益')) === '180,000円', await 値('将来利益'));

console.log('■ カワダ 二郎（30,003円 → 75%で端数が出る）');
await 選ぶ('カワダ 二郎');
check('買戻し金額は切り捨てて 22,502円', (await 値('買戻し金額')) === '22,502円',
  await 値('買戻し金額'));
check('将来利益 7,501円', (await 値('将来利益')) === '7,501円', await 値('将来利益'));
check('切り捨てと書いてある', (await p.locator('.calc-foot').innerText()).includes('切り捨て'));

console.log('■ サトウ 三郎（40,000円 / 35,000円入金）');
await 選ぶ('サトウ 三郎');
check('未払い残債 5,000円', (await 表()).includes('5,000円'), await 表());
check('買戻し金額 3,750円', (await 値('買戻し金額')) === '3,750円', await 値('買戻し金額'));
await p.screenshot({ path: '/tmp/calc-2.png' });

console.log('■ 検索で絞れる');
await p.locator('.calc .search').fill('カワダ');
await p.waitForTimeout(300);
check('1名になる', (await p.locator('.calc-c').count()) === 1);
await p.locator('.calc .search').fill('');

console.log('■ スマホでも横にはみ出さない');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("計算")');
await sp.waitForSelector('.calc-c');
await sp.locator('.calc-c', { hasText: 'アオキ 一郎' }).click();
await sp.waitForSelector('.calc-a');
await sp.waitForTimeout(400);
check('結果が出る', (await sp.locator('.calc-a[data-k="買戻し金額"]').innerText()).trim() === '472,500円');
check('横にはみ出さない',
  await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await sp.screenshot({ path: '/tmp/calc-sp.png', fullPage: true });

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
