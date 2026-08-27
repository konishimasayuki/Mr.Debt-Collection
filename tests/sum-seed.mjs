// 残債の総額の検査のための土台。ふつう2名・引き上げ1名・完済1名
import { client, call, reset } from './h.js';
await client.connect();
await reset();
await call('setup', { method: 'POST', body: {} });
const 作る = async (o) => (await call('customers', { method: 'POST', body: o })).body;
const 払う = (id, 日, 額) => call('payments', { method: 'POST', body: {
  顧客id: id, 日付: 日, 金額: 額, メモ: '現金で受け取った' } });

// あ行：残債 300,000（10回 × 30,000、うち0回入金）
const A = await 作る({ 名前: 'アイダ 一郎', よみ: 'アイダ イチロウ',
  月々の金額: 30000, 回数: 10, 支払日: 27, 開始月: '2026-09' });
// か行：残債 170,000（10回 × 20,000 のうち 30,000 入金）
const B = await 作る({ 名前: 'カワダ 二郎', よみ: 'カワダ ジロウ',
  月々の金額: 20000, 回数: 10, 支払日: 27, 開始月: '2026-09' });
await 払う(B.id, '2026-09-27', 30000);
// さ行：引き上げ。残債 500,000 だが総額には入れない
const C = await 作る({ 名前: 'サトウ 三郎', よみ: 'サトウ サブロウ',
  月々の金額: 50000, 回数: 10, 支払日: 27, 開始月: '2026-09' });
await call('customer', { method: 'PATCH', body: {
  id: C.id, 状態: '回収', 状態日: '2026-09-01' } });
// た行：完済。残債 0
const D = await 作る({ 名前: 'タナカ 四郎', よみ: 'タナカ シロウ',
  月々の金額: 10000, 回数: 2, 支払日: 27, 開始月: '2026-09' });
await 払う(D.id, '2026-09-27', 20000);

const l = (await call('customers')).body.顧客;
for (const r of l) console.log(r.氏名, r.残債金額, r.終了理由 || '—');
await client.end();
