// 未払い顧客タブと、計算タブの請求書（arr-seed.mjs の土台で走らせる）
// 請求書は計算タブからだけ出す。未払い顧客タブには請求書の道を置かない
import { 開く, 入る, check, 終わる } from './ui.js';

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

console.log('■ 未払い顧客タブ');
const タブ = await p.locator('.tabs .tab').allInnerTexts();
check('タブがある', タブ.includes('未払い顧客'), タブ);
check('未入金の隣', タブ.indexOf('未払い顧客') === タブ.indexOf('未入金') + 1, タブ);
await p.click('.tab:has-text("未払い顧客")');
await p.waitForSelector('.arr-sec');
await p.waitForTimeout(500);
const 欄 = await p.locator('.arr-sec .arr-h h3').allInnerTexts();
check('エンジンストップ・1か月分・2か月分・3か月分以上の順',
  JSON.stringify(欄) === JSON.stringify(['エンジンストップ', '1か月分', '2か月分', '3か月分以上']), 欄);
const 欄の中 = async (区) => p.locator(`.arr-sec[data-k="${区}"]`).innerText();
check('エンジンストップにタナカ', (await 欄の中('エンジンストップ')).includes('タナカ 四郎'));
check('1か月分にアオキ', (await 欄の中('1か月分')).includes('アオキ 一郎'));
check('2か月分にカワダ', (await 欄の中('2か月分')).includes('カワダ 二郎'));
check('3か月分以上にサトウ', (await 欄の中('3か月分以上')).includes('サトウ 三郎'));
check('期日前の人は出ない', !(await p.locator('main').innerText()).includes('エンドウ 五郎'));
check('引き上げた人は出ない', !(await p.locator('main').innerText()).includes('オオタ 六郎'));
const 見出し = await p.locator('.arr-sec thead').first().innerText();
for (const 列 of ['お客様名', '未払い額', '車両', '残債額']) {
  check(`列「${列}」がある`, 見出し.includes(列), 見出し);
}
const 二郎 = p.locator('tbody tr', { hasText: 'カワダ 二郎' });
check('未払い額 100,000円', (await 二郎.innerText()).includes('100,000円'), await 二郎.innerText());
check('車両 タントカスタム', (await 二郎.innerText()).includes('タントカスタム'));
check('残債額 1,150,000円', (await 二郎.innerText()).includes('1,150,000円'));
check('合計が出る（本物の4名）', (await p.locator('.bar .sub').innerText()).includes('4名'),
  await p.locator('.bar .sub').innerText());
check('請求書のボタンは置かない（請求書は計算タブからだけ）',
  (await p.locator('.arr-sec button').count()) === 0, await p.locator('.arr-sec button').count());
await p.screenshot({ path: '/tmp/arr-1.png', fullPage: true });

console.log('■ 行を押すと顧客ページ');
await p.locator('tbody tr', { hasText: 'アオキ 一郎' }).locator('td.nm b').click();
await p.waitForSelector('.rec-top');
check('顧客ページが開く', (await p.locator('.cust-name').innerText()).includes('アオキ 一郎'));

console.log('■ 計算タブで顧客を選んで、請求書を作る');
await p.click('.tab:has-text("計算")');
await p.waitForSelector('.calc-c');
await p.locator('.calc-c', { hasText: 'カワダ 二郎' }).click();
await p.waitForSelector('.calc-inv button');
await p.click('.calc-inv button');
await p.waitForSelector('.inv-page');
await p.waitForTimeout(500);
const 紙 = p.locator('.inv-page');
const 文 = async () => 紙.innerText();
check('宛先は請求先の会社（はじめは債権譲渡会社）',
  (await p.locator('[data-k="宛名"]').innerText()) === '株式会社エンジン 御中',
  await p.locator('[data-k="宛名"]').innerText());
const 先 = async () => p.locator('[data-k="請求先"]').innerText();
check('請求先の住所と〒', (await 先()).includes('〒830-0032 福岡県久留米市東町1-1'), await 先());
check('請求先のご担当者と電話', (await 先()).includes('経理部 山田 様') && (await 先()).includes('0942-00-1111'));
check('お客様の住所は刷らない', !(await 文()).includes('東京都千代田区千代田1-1'), await 文());
check('発行者は MIAMIホールディングス',
  (await p.locator('[data-k="発行者"]').innerText()).includes('MIAMIホールディングス'));
check('お支払いの遅れの行は無い', !(await 文()).includes('お支払いの遅れ'), await 文());
check('遅れの月数も刷らない', !(await 文()).includes('か月分'), await 文());
check('表のお客様名', (await p.locator('[data-k="お客様名"]').innerText()) === 'カワダ 二郎 様');
for (const [名, 値] of [
  ['契約金額', '1,200,000円'], ['買取金額', '900,000円'], ['お客様が支払った金額', '50,000円'],
  ['残債', '1,150,000円'], ['買戻し金額', '862,500円'],
]) {
  const 行 = 紙.locator('tr', { hasText: 名 }).first();
  check(`${名} ${値}`, (await 行.innerText()).includes(値), await 行.innerText());
}
check('ご請求金額は買戻し金額', (await p.locator('[data-k="ご請求金額"]').innerText()) === '¥862,500');
check('75%は手数料と刷る（買戻し率ではない）',
  (await 文()).includes('④ × 手数料75%') && (await 文()).includes('① × 手数料75%')
  && !(await 文()).includes('買戻し率'), await 文());
check('車種名', (await 文()).includes('タントカスタム'));
check('契約日', /年.*月15日/.test(await 紙.locator('tr', { hasText: '契約日' }).innerText()));
check('車体番号は空欄（手書き用）',
  (await p.locator('[data-k="車体番号"]').innerText()).trim() === '');

console.log('■ 刷るお客様名を直せる（保存はしない）');
await p.locator('[data-k="お客様名を直す"]').fill('河田 二郎');
check('表のお客様名が変わる', (await p.locator('[data-k="お客様名"]').innerText()) === '河田 二郎 様');

console.log('■ 請求先を選び直せる');
await p.locator('[data-k="請求先を選ぶ"]').selectOption({ label: '株式会社Three Eight' });
check('別の会社になる', (await p.locator('[data-k="宛名"]').innerText()) === '株式会社Three Eight 御中');
check('住所が無い会社は住所を刷らない', !(await 先()).includes('〒'), await 先());
await p.locator('[data-k="請求先を選ぶ"]').selectOption('');
check('選ばなければ空けて刷る（御中だけ）',
  (await p.locator('[data-k="宛名"]').innerText()).trim() === '御中',
  await p.locator('[data-k="宛名"]').innerText());
await p.locator('[data-k="請求先を選ぶ"]').selectOption({ label: '株式会社エンジン' });

console.log('■ 車体番号を手で打てる（保存はしない）');
await p.locator('.inv-grid input[placeholder*="手書き"]').fill('LA650S-0123456');
check('紙に刷られる', (await p.locator('[data-k="車体番号"]').innerText()) === 'LA650S-0123456');
check('自社の住所が無いと知らせる', (await p.locator('.inv-warn').count()) === 1);
await p.screenshot({ path: '/tmp/arr-inv.png', fullPage: true });

console.log('■ 印刷すると紙だけが出る');
await p.emulateMedia({ media: 'print' });
check('打つ欄は刷らない', await p.evaluate(() =>
  getComputedStyle(document.querySelector('.inv-edit')).display === 'none'));
check('タブは見えない', await p.evaluate(() =>
  getComputedStyle(document.querySelector('.tabs')).visibility === 'hidden'));
check('紙は見える', await p.evaluate(() =>
  getComputedStyle(document.querySelector('.inv-page')).visibility === 'visible'));
await p.pdf({ path: '/tmp/arr-inv.pdf', format: 'A4', printBackground: true });
await p.emulateMedia({ media: 'screen' });

console.log('■ 閉じると計算に戻る');
await p.click('.inv-edit button:has-text("閉じる")');
await p.waitForSelector('.calc-a');
check('計算の画面', (await p.locator('.calc-name').innerText()) === 'カワダ 二郎');

console.log('■ 設定の債権会社で、請求先の住所を直せる');
await p.click('.tab:has-text("設定")');
await p.waitForSelector('.issuer-f');
await p.waitForTimeout(400);
await p.locator('tr', { hasText: '株式会社Three Eight' }).locator('button:has-text("編集")').click();
await p.waitForSelector('.modal-box');
const 会欄 = (名) => p.locator('.modal-box .f', { has: p.locator(`label:text-is("${名}")`) }).locator('input');
await 会欄('郵便番号').fill('１０００００１');
await 会欄('住所').fill('東京都千代田区千代田1-1');
await p.click('.modal-box button:has-text("保存する")');
await p.waitForTimeout(800);
check('一覧に住所が出る', (await p.locator('tr', { hasText: '株式会社Three Eight' }).innerText())
  .includes('〒100-0001 東京都千代田区千代田1-1'),
  await p.locator('tr', { hasText: '株式会社Three Eight' }).innerText());
check('自社の欄の見出し', (await p.locator('.issuer h3').innerText()) === '自社（請求書の発行者）');

console.log('■ 設定で発行者を変えると、請求書も変わる');
await p.click('.tab:has-text("設定")');
await p.waitForSelector('.issuer-f');
await p.waitForTimeout(400);
const 欄を = (名) => p.locator('.issuer-f .f', { has: p.locator(`label:text-is("${名}")`) }).locator('input');
check('既定の名称が入っている', (await 欄を('会社名（必須）').inputValue()) === 'MIAMIホールディングス');
await 欄を('会社名（必須）').fill('株式会社テスト商会');
await 欄を('住所').fill('福岡県久留米市東町1-1');
await 欄を('振込先').fill('◯◯銀行 本店 普通 1234567');
await p.click('.issuer-f button:has-text("保存する")');
await p.waitForSelector('.ok-msg');
await p.click('.tab:has-text("計算")');
await p.waitForSelector('.calc-c');
await p.locator('.calc-c', { hasText: 'カワダ 二郎' }).click();
await p.waitForSelector('.calc-inv button');
await p.click('.calc-inv button');
await p.waitForSelector('.inv-page');
await p.waitForTimeout(300);
check('新しい発行者で刷る',
  (await p.locator('[data-k="発行者"]').innerText()).includes('株式会社テスト商会'));
check('振込先も刷る', (await p.locator('.inv-page').innerText()).includes('◯◯銀行 本店 普通 1234567'));
check('足りないという知らせは消える', (await p.locator('.inv-warn').count()) === 0);

console.log('■ スマホでも横にはみ出さない');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("未払い顧客")');
await sp.waitForSelector('.arr-sec');
await sp.waitForTimeout(500);
check('未払い顧客', await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await sp.click('.tab:has-text("計算")');
await sp.waitForSelector('.calc-c');
await sp.locator('.calc-c', { hasText: 'カワダ 二郎' }).click();
await sp.waitForSelector('.calc-inv button');
await sp.click('.calc-inv button');
await sp.waitForSelector('.inv-page');
await sp.waitForTimeout(400);
check('請求書', await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
