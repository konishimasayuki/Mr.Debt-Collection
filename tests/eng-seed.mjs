// エンジンストップの土台。目印2名＋エンジンストップ1名
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
const 作る = async (名, よみ, 額) => (await call('customers', { method: 'POST', body: {
  名前: 名, よみ, 月々の金額: 額, 回数: 24, 支払日: 1, 開始月: 開始 } })).body;

const A = await 作る('アオキ 一郎', 'アオキ イチロウ', 30000);
const B = await 作る('カワダ 二郎', 'カワダ ジロウ', 50000);
const C = await 作る('サトウ 三郎', 'サトウ サブロウ', 20000);
const D = await 作る('タナカ 四郎', 'タナカ シロウ', 40000);

await call('payments', { method: 'POST', body: {
  顧客id: A.id, 日付: `${開始}-01`, 金額: 90000, メモ: '現金で受け取った' } });

// 目印：一郎と三郎
for (const id of [A.id, C.id]) {
  await call('customer', { method: 'PATCH', body: { id, 目印: true } });
}
// エンジンストップ：二郎
const r = await call('customer', { method: 'PATCH', body: {
  id: B.id, 状態: 'エンジンストップ', 状態日: `${開始}-15` } });
console.log('エンジンストップにした:', r.code, r.body && r.body.error ? r.body.error : '');
// 引き上げ：四郎（終わった取引。エンジンストップと混ざらないこと）
await call('customer', { method: 'PATCH', body: {
  id: D.id, 状態: '回収', 状態日: `${開始}-20` } });

const l = (await call('customers')).body;
for (const x of l.顧客) {
  console.log(`${x.氏名}  目印:${x.目印}  停止:${x.エンジンストップ}`
    + `  終了:${x.終了}${x.終了理由 ? '(' + x.終了理由 + ')' : ''}`);
}
const d = (await call('dashboard')).body;
console.log('ダッシュボードに出る人:',
  [...new Set(d.月.flatMap((m) => m.行.map((x) => x.氏名)))].join('、'));
await client.end();
