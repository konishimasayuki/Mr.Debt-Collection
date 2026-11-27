// 金額の決まりの土台。決まりのある人（1回目だけ払ってある）
import { client, call, reset } from './h.js';
await client.connect();
await reset();
await call('setup', { method: 'POST', body: {} });
const r = await call('customers', { method: 'POST', body: {
  名前: 'アオキ 一郎', よみ: 'アオキ イチロウ', 月々の金額: 30000, 回数: 6, 支払日: 10,
  開始月: '2027-01', 偶数月: 40000, 奇数月: 30000, 最終回: 10000 } });
await call('payments', { method: 'POST', body: {
  顧客id: r.body.id, 日付: '2026-11-01', 金額: 30000, メモ: '1回目' } });
const d = (await call('customer', { q: { id: r.body.id } })).body;
console.log('アオキ 一郎', d.支払予定.map((s) => `${s.回次}:${s.請求}${s.入金 ? '(済)' : ''}`).join(' '),
  '総額', d.顧客.支払総額);
await client.end();
