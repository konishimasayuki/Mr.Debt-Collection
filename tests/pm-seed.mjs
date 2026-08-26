// 入金月変更の検査のための土台。24回・毎月27日・2026-09 から。1〜2回目は入金済み
import { client, call, reset } from './h.js';
await client.connect();
await reset();
await call('setup', { method: 'POST', body: {} });
const A = (await call('customers', { method: 'POST', body: {
  名前: '月変 太郎', よみ: 'ツキヘン タロウ',
  月々の金額: 30000, 回数: 24, 支払日: 27, 開始月: '2026-09' } })).body;
for (const 日 of ['2026-09-27', '2026-10-27']) {
  await call('payments', { method: 'POST', body: {
    顧客id: A.id, 日付: 日, 金額: 30000, メモ: '現金で受け取った' } });
}
const d = (await call('customer', { q: { id: A.id } })).body;
console.log('顧客id:', A.id);
console.log('未払いの先頭:', d.支払予定.find((s) => s.状態 !== '入金済み').期日);
await client.end();
