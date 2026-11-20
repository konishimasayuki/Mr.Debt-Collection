// 計算の土台。総支払金額と支払った総額が分かっている3名
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
const 開始 = 前月(3);
const 作る = async (名, よみ, 額, 回, 譲渡先) => (await call('customers', { method: 'POST', body: {
  名前: 名, よみ, 月々の金額: 額, 回数: 回, 支払日: 1, 開始月: 開始,
  ...(譲渡先 ? { 債権譲渡先: 譲渡先 } : {}) } })).body;
const 入れる = (id, 金額) => call('payments', { method: 'POST', body: {
  顧客id: id, 日付: `${開始}-01`, 金額, メモ: '検査のための入金' } });

// 画像の計算例そのまま。1,700,000円 / 300,000円入金 → 残債1,400,000 × 75% = 1,050,000
const MIAMI = (await call('companies', { method: 'POST', body: { 名前: 'MIAMI' } })).body;
const E = await 作る('エンドウ 五郎', 'エンドウ ゴロウ', 85000, 20, MIAMI.id);
await 入れる(E.id, 300000);
// 720,000円 / 90,000円入金 → 残債630,000 × 75% = 472,500 / 将来利益180,000
const A = await 作る('アオキ 一郎', 'アオキ イチロウ', 30000, 24);
await 入れる(A.id, 90000);
// 30,003円 / 入金なし → 残債30,003 × 75% = 22,502.25 → 22,502（切り捨て）/ 将来利益7,501
await 作る('カワダ 二郎', 'カワダ ジロウ', 10001, 3);
// 40,000円 / 35,000円入金 → 残債5,000 × 75% = 3,750
const C = await 作る('サトウ 三郎', 'サトウ サブロウ', 10000, 4);
await 入れる(C.id, 35000);

for (const x of (await call('customers')).body.顧客) {
  const c = (await call('customer', { q: { id: x.id } })).body.顧客;
  console.log(`${c.氏名}  総支払金額:${c.支払総額}  支払った総額:${c.入金合計}`);
}
await client.end();
