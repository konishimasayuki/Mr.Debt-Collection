// 入金月の変更を、顧客情報の編集の中でできること
import { 開く, 入る, check, 終わる } from './ui.js';

const b = await 開く();
const p = await 入る(b);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
const 欄 = (親, 名) => 親.locator(`.f:has(label:text-is("${名}")) input`);

await p.click('.tab:has-text("顧客一覧")');
await p.waitForSelector('tbody tr.clickable');
await p.click('td:has-text("月変 太郎")');
await p.waitForSelector('.rec-top');
await p.waitForTimeout(800);
const 記 = p.locator('.sec', { hasText: '支払いの記録' });
const 前 = await 記.innerText();
check('3回目は11月', /3回\s*11\/27/.test(前), 前.slice(0, 200));

console.log('■ 編集の外に「入金月変更」ボタンは無い');
check('別画面への入口が無い',
  (await p.locator('button:has-text("入金月変更")').count()) === 0);

console.log('■ 顧客編集の中に欄がある');
await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(600);
const m = p.locator('.modal-box');
const 枠 = m.locator('.sect', { hasText: '入金月の変更' });
check('入金月の変更の欄がある', (await 枠.count()) === 1);
check('別画面へのボタンは無い',
  (await m.locator('button:has-text("入金月変更")').count()) === 0);
const 月 = 欄(枠, '新しい入金月');
check('いまの先頭の月が入っている', (await 月.inputValue()) === '2026-11',
  await 月.inputValue());
check('未払いの回数を出す', (await 枠.innerText()).includes('未払いの22回だけ'),
  await 枠.innerText());
check('起点を出す', (await 枠.innerText()).includes('3回目'), await 枠.innerText());
check('変える前は知らせが出ない', (await 枠.locator('.note.warn').count()) === 0);

console.log('■ 保証人の欄に説明は出ていない');
const 保 = m.locator('.contact', { hasText: '連帯保証人' });
check('「空にすると消えます」は無い', (await 保.locator('.sect-note').count()) === 0,
  await 保.innerText());

console.log('■ 月を変えると、どうずれるかを見せる');
await 月.fill('2027-02');
await p.waitForTimeout(400);
const 知 = await 枠.locator('.note.warn').innerText();
check('ずれ方を出す', 知.includes('3か月あと'), 知);
check('移す先を出す', 知.includes('2027/02/27'), 知);
check('入金は動かないと書いてある', 知.includes('入金の行き先も動きません'), 知);
await 枠.scrollIntoViewIfNeeded();
await p.waitForTimeout(300);
await m.screenshot({ path: '/tmp/pm-1.png' });

console.log('■ 理由が無いと保存できない');
await p.click('.modal-foot .btn-main');
await p.waitForTimeout(600);
check('欄は開いたまま', (await p.locator('.modal-box').count()) === 1);
check('理由を書けと言う',
  (await m.locator('.err').innerText()).includes('変更の理由'),
  await m.locator('.err').innerText());

console.log('■ 理由を書けば、顧客情報と一緒に保存できる');
await 欄(枠, '変更の理由（変えるなら必ず）').fill('入院のため、2月から再開すると合意');
await 欄(m, '電話番号').first().fill('090-5555-6666');
await p.click('.modal-foot .btn-main');
await p.waitForSelector('.modal-box', { state: 'detached', timeout: 15000 });
await p.waitForTimeout(1400);
const 後 = await 記.innerText();
check('3回目が2月になる', /3回\s*02\/27/.test(後), 後.slice(0, 200));
check('払い終えた1回目は動かない', /1回\s*09\/27/.test(後), 後.slice(0, 200));
check('顧客情報のほうも変わる',
  (await p.locator('.cust-sub').innerText()).includes('090-5555-6666'),
  await p.locator('.cust-sub').innerText());
await 記.screenshot({ path: '/tmp/pm-2.png' });

console.log('■ 理由は支払いの記録に残る');
await 記.locator('.rec-tap', { hasText: '3回' }).first().click();
await p.waitForTimeout(500);
check('理由が読める', (await 記.innerText()).includes('入院のため'), 記.innerText());

console.log('■ 月を変えなければ、顧客情報だけを直せる');
await p.click('button:has-text("顧客情報を編集")');
await p.waitForSelector('.modal-box');
await p.waitForTimeout(600);
const m2 = p.locator('.modal-box');
check('先頭が2月になっている',
  (await 欄(m2.locator('.sect', { hasText: '入金月の変更' }), '新しい入金月')
    .inputValue()) === '2027-02');
await 欄(m2, '車種').fill('タントカスタム');
await p.click('.modal-foot .btn-main');
await p.waitForSelector('.modal-box', { state: 'detached', timeout: 15000 });
await p.waitForTimeout(1400);
check('車種が入る', (await p.locator('.cust-sub').innerText()).includes('タントカスタム'));
check('期日は動かない', /3回\s*02\/27/.test(await 記.innerText()));

console.log('■ スマホでも横にはみ出さない');
const sp = await 入る(b, 390, 844);
await sp.click('.tab:has-text("顧客一覧")');
await sp.waitForSelector('tbody tr.clickable');
await sp.click('td:has-text("月変 太郎")');
await sp.waitForSelector('.rec-top');
await sp.waitForTimeout(800);
await sp.click('button:has-text("顧客情報を編集")');
await sp.waitForSelector('.modal-box');
await sp.waitForTimeout(600);
check('スマホでも欄がある',
  (await sp.locator('.modal-box .sect', { hasText: '入金月の変更' }).count()) === 1);
check('横にはみ出さない',
  await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await sp.screenshot({ path: '/tmp/pm-3-sp.png' });

check('JSのエラーが出ていない', errs.length === 0, errs.slice(0, 3));
await 終わる(b);
