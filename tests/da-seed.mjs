// ダッシュボードの画面検査のための土台。
//
// **どの日に走らせても同じ形になるように作る。**
// 支払日を決め打ちにすると、その日を過ぎた翌日から「期日前」が消えて落ちる。
//   ・ずっと前から続く人 … 支払日は 1日。いつ走らせても期日は過ぎている
//   ・今月これから払う人 … 支払日は 月末。今日が月末でなければ期日前になる
import { client, call, reset } from './h.js';

const 前月 = (n) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

await client.connect();
await reset();
await call('setup', { method: 'POST', body: {} });

// ── 期日の過ぎた人（2か月前から、毎月1日）──────────────
const 開始 = 前月(2);
const A = (await call('customers', { method: 'POST', body: {
  名前: 'ダッシュ 一郎', よみ: 'ダッシュ イチロウ',
  月々の金額: 30000, 回数: 6, 支払日: 1, 開始月: 開始 } })).body;
await call('customers', { method: 'POST', body: {
  名前: 'ダッシュ 二郎', よみ: 'ダッシュ ジロウ',
  月々の金額: 50000, 回数: 6, 支払日: 1, 開始月: 開始 } });
// 一郎の初回だけ入金済みにする（回収済みの回を作るため）
await call('payments', { method: 'POST', body: {
  顧客id: A.id, 日付: `${開始}-01`, 金額: 30000, メモ: '現金で受け取った' } });

// ── まだ期日の来ていない人（今月の月末払い）────────────
const 今 = (await call('dashboard')).body.本日;
const 今月 = 今.slice(0, 7);
const 今日 = Number(今.slice(8, 10));
const 末日 = new Date(Date.UTC(Number(今月.slice(0, 4)), Number(今月.slice(5, 7)), 0))
  .getUTCDate();
const 期日前あり = 今日 < 末日;
if (期日前あり) {
  await call('customers', { method: 'POST', body: {
    名前: 'ダッシュ 遅子', よみ: 'ダッシュ オソコ',
    月々の金額: 70000, 回数: 6, 支払日: 末日, 開始月: 今月 } });
}

const d = (await call('dashboard')).body;
console.log('本日:', 今, '／期日前を作った:', 期日前あり);
for (const m of d.月) {
  console.log(m.年月, '予定', m.予定回収額, '期日前', m.期日前額,
    '合計', m.月の合計, '未回収', m.未回収額, `${m.回収済み}/${m.全件}`);
}
await client.end();
