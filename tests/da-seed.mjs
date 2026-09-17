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

const d = (await call('dashboard')).body;
for (const m of d.月) console.log(m.年月, '予定', m.予定回収額, '未回収', m.未回収額,
  `${m.回収済み}/${m.全件}`);
await client.end();
