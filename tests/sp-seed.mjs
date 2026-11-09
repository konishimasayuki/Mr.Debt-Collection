// 小分けの入金の見た目：払い終えた回はまとめる／払い終えていない回はまとめない
import { client, call, reset } from './h.js';

await client.connect();
await reset();
await call('setup', { method: 'POST', body: {} });

const A = (await call('customers', { method: 'POST', body: {
  名前: 'コワケ 太郎', よみ: 'コワケ タロウ',
  月々の金額: 30000, 回数: 12, 支払日: 27, 開始月: '2026-09' } })).body;
const 払う = (日, 額) => call('payments', { method: 'POST', body: {
  顧客id: A.id, 日付: 日, 金額: 額, メモ: '現金で受け取った' } });

// 1回目：3回に分けて払い終える（まとめる）
await 払う('2026-09-20', 10000);
await 払う('2026-09-25', 10000);
await 払う('2026-09-27', 10000);
// 2回目：2回に分けて払い終える（まとめる）
await 払う('2026-10-20', 15000);
await 払う('2026-10-27', 15000);
// 3回目：2回入れたが、まだ足りない（まとめない）。
// 充当は古い回から埋まるので、ここから先は足りないまま残る
await 払う('2026-11-20', 8000);
await 払う('2026-11-25', 7000);

const d = (await call('customer', { q: { id: A.id } })).body;
for (const s of d.支払予定.slice(0, 6)) {
  console.log(`${s.回次}回 ${s.期日} ${s.状態}  入金${s.入金}/${s.請求}`
    + `  明細${s.入金明細.length}件`);
}
console.log('顧客id:', A.id);
await client.end();
