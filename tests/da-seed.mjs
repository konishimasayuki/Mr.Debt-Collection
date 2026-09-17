// ダッシュボードの画面検査のための土台。
// 2か月前から毎月20日。一郎 30,000円／二郎 50,000円。一郎の初回だけ入金済み
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
const 開始 = 前月(2);
const A = (await call('customers', { method: 'POST', body: {
  名前: 'ダッシュ 一郎', よみ: 'ダッシュ イチロウ',
  月々の金額: 30000, 回数: 6, 支払日: 20, 開始月: 開始 } })).body;
await call('customers', { method: 'POST', body: {
  名前: 'ダッシュ 二郎', よみ: 'ダッシュ ジロウ',
  月々の金額: 50000, 回数: 6, 支払日: 20, 開始月: 開始 } });
await call('payments', { method: 'POST', body: {
  顧客id: A.id, 日付: `${開始}-20`, 金額: 30000, メモ: '現金で受け取った' } });

// 今月ぶん。支払日を今日の前後に分けて、まだ期日の来ていない回を作る。
// 9月17日に見ると「9月分 30,000円」と出ていた不具合を、画面でも押さえる
const 今 = (await call('dashboard')).body.本日;
const 今月 = 今.slice(0, 7);
const 今日 = Number(今.slice(8, 10));
const 末日 = new Date(Date.UTC(Number(今月.slice(0, 4)), Number(今月.slice(5, 7)), 0))
  .getUTCDate();
const 早い日 = Math.max(1, 今日 - 1);
const 遅い日 = Math.min(末日, 今日 + 1);
if (早い日 < 遅い日) {
  await call('customers', { method: 'POST', body: {
    名前: 'ダッシュ 早子', よみ: 'ダッシュ ハヤコ',
    月々の金額: 20000, 回数: 6, 支払日: 早い日, 開始月: 今月 } });
  await call('customers', { method: 'POST', body: {
    名前: 'ダッシュ 遅子', よみ: 'ダッシュ オソコ',
    月々の金額: 70000, 回数: 6, 支払日: 遅い日, 開始月: 今月 } });
}

const d = (await call('dashboard')).body;
for (const m of d.月) console.log(m.年月, '予定', m.予定回収額, '未回収', m.未回収額,
  '期日前', m.期日前額, `${m.回収済み}/${m.全件}`);
await client.end();
