// 賞与の回数・移動を試すための顧客
import { client, call, reset } from './h.js';
await client.connect();
await reset();
await call('setup', { method: 'POST', body: {} });
const A = (await call('customers', { method: 'POST', body: {
  名前: '賞与 太郎', よみ: 'ショウヨ タロウ',
  月々の金額: 50000, 回数: 48, 支払日: 27, 開始月: '2026-05' } })).body;
await call('customer', { method: 'PATCH', body: {
  id: A.id, ボーナス月: [7, 12], ボーナス日: 27, ボーナス金額: 100000 } });
await client.end();
console.log('用意した');
