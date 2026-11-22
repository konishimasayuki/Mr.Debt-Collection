// 未払い顧客と請求書の土台
//   アオキ 一郎 … 1か月分（今月の1日が過ぎて未払い）
//   カワダ 二郎 … 2か月分（3回のうち1回だけ払った）。請求書の数字を見る人
//   サトウ 三郎 … 3か月分以上（4回とも未払い）
//   タナカ 四郎 … エンジンストップ（2か月分たまっている）
//   エンドウ 五郎 … まだ期日が来ていない（出さない）
//   オオタ 六郎 … 引き上げ済み（出さない）
import { client, call, reset } from './h.js';

export const 前月 = (n) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

await client.connect();
await reset();
await call('setup', { method: 'POST', body: {} });
const 作る = async (名, よみ, 額, 開始, 他 = {}) => (await call('customers', { method: 'POST', body: {
  名前: 名, よみ, 月々の金額: 額, 回数: 24, 支払日: 1, 開始月: 開始, ...他 } })).body;

const A = await 作る('アオキ 一郎', 'アオキ イチロウ', 30000, 前月(0), { 車種: 'ムーヴ' });
const B = await 作る('カワダ 二郎', 'カワダ ジロウ', 50000, 前月(2), {
  車種: 'タントカスタム', 契約日: `${前月(3)}-15`,
  郵便番号: '1000001', 住所: '東京都千代田区千代田1-1' });
await call('payments', { method: 'POST', body: {
  顧客id: B.id, 日付: `${前月(2)}-01`, 金額: 50000, メモ: '1回目だけ入った' } });
const C = await 作る('サトウ 三郎', 'サトウ サブロウ', 20000, 前月(3), { 車種: 'N-BOX' });
const D = await 作る('タナカ 四郎', 'タナカ シロウ', 40000, 前月(1), { 車種: 'ワゴンR' });
await call('customer', { method: 'PATCH', body: { id: D.id, 状態: 'エンジンストップ' } });
await 作る('エンドウ 五郎', 'エンドウ ゴロウ', 10000, 前月(-1));
const F = await 作る('オオタ 六郎', 'オオタ ロクロウ', 10000, 前月(2));
await call('customer', { method: 'PATCH', body: { id: F.id, 状態: '回収' } });

for (const r of (await call('customers', { q: { 未払い顧客: 1 } })).body.顧客) {
  console.log(`${r.区分}  ${r.氏名}  ${r.滞納月数}か月  未払い:${r.未払い額}  残債:${r.残債金額}  車:${r.車種}`);
}
void A; void C;
await client.end();
