// ご報告と同じ形：48回・毎月27日・2026-06 から。8月と12月に15万、開始は2026-12
import { client, call, reset } from './h.js';
await client.connect();
await reset();
await call('setup', { method: 'POST', body: {} });
const A = (await call('customers', { method: 'POST', body: {
  名前: '賞与 太郎', よみ: 'ショウヨ タロウ',
  月々の金額: 50663, 回数: 48, 支払日: 27, 開始月: '2026-06' } })).body;
await call('customer', { method: 'PATCH', body: {
  id: A.id, ボーナス月: [8, 12], ボーナス日: 27, ボーナス金額: 150000,
  ボーナス開始月: '2026-12' } });
const d = (await call('customer', { q: { id: A.id } })).body;
console.log('通常の初回:', d.支払予定.find((s) => s.種類 === '通常').期日);
console.log('通常の最終:', d.支払予定.filter((s) => s.種類 === '通常').slice(-1)[0].期日);
console.log('賞与:', d.支払予定.filter((s) => s.種類 === 'ボーナス')
  .map((s) => `${s.回次}:${s.期日}`).join(' '));
await client.end();
