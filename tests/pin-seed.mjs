// 画面を見るための土台。目印・月ごとの回収・少額隠しを一度に見る
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
const 払う = (id, 日, 額) => call('payments', { method: 'POST', body: {
  顧客id: id, 日付: 日, 金額: 額, メモ: '現金で受け取った' } });

const A = await 作る('アオキ 一郎', 'アオキ イチロウ', 30000);
const B = await 作る('カワダ 二郎', 'カワダ ジロウ', 50000);
const C = await 作る('サトウ 三郎', 'サトウ サブロウ', 20000);

// 一郎：3か月ぶん払い済み
await 払う(A.id, `${開始}-01`, 90000);
// 二郎：2か月ぶん払い、3か月目はほぼ払い終えて端数だけ残す（少額隠しのため）
await 払う(B.id, `${開始}-01`, 100000 + 49500);
// 三郎：1か月ぶんだけ
await 払う(C.id, `${開始}-01`, 20000);

// 一郎と三郎に目印
for (const id of [A.id, C.id]) {
  await call('customer', { method: 'PATCH', body: { id, 目印: true } });
}

const l = (await call('customers')).body;
console.log('目印:', l.顧客.filter((r) => r.目印).map((r) => r.氏名).join('、'));
console.log('月ごと:');
for (const m of l.月ごと) {
  console.log(`  ${m.見出し}  予定 ${m.予定}  入金済み ${m.入金済み}  残り ${m.残り}`
    + (m.今月 ? '  ←今月' : ''));
}
const dd = (await call('dashboard')).body;
console.log('ダッシュボードの残り額:',
  dd.月.flatMap((m) => m.行.map((r) => r.残り)).join(', '));
await client.end();
