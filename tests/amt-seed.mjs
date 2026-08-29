// 金額変更の画面検査のための土台。10回 × 30,000円、2回目まで入金済み
import { client, call, reset } from './h.js';
await client.connect();
await reset();
await call('setup', { method: 'POST', body: {} });
const A = (await call('customers', { method: 'POST', body: {
  名前: '額変 太郎', よみ: 'ガクヘン タロウ',
  月々の金額: 30000, 回数: 10, 支払日: 27, 開始月: '2026-09' } })).body;
await call('payments', { method: 'POST', body: {
  顧客id: A.id, 日付: '2026-09-27', 金額: 60000, メモ: '現金で受け取った' } });
const d = (await call('customer', { q: { id: A.id } })).body;
console.log('顧客id:', A.id, '／支払総額:', d.顧客.支払総額, '／残債:', d.顧客.残債);
await client.end();
