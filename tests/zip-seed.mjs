// 郵便番号の土台。番号を入れた人と、住所だけの人を1名ずつ
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
const 開始 = 前月(2);
const 作る = async (名, よみ, 郵, 住) => (await call('customers', { method: 'POST', body: {
  名前: 名, よみ, 郵便番号: 郵, 住所: 住,
  月々の金額: 30000, 回数: 24, 支払日: 1, 開始月: 開始 } })).body;

// 番号を入れてある人
const A = await 作る('アオキ 一郎', 'アオキ イチロウ', '8300032', '福岡県久留米市東町1-1');
// 番号は空で、住所だけの人（町域まで当たる → 100-0001）
const B = await 作る('カワダ 二郎', 'カワダ ジロウ', '', '東京都千代田区千代田1-1');
// 番号も住所も空の人
const C = await 作る('サトウ 三郎', 'サトウ サブロウ', '', '');
// 住所はあるが、町域まで決まらない人（市区町村までの推定 → 604-0000）
const D = await 作る('タナカ 四郎', 'タナカ シロウ', '', '京都府京都市中京区烏丸通');

for (const id of [A.id, B.id, C.id, D.id]) {
  const c = (await call('customer', { q: { id } })).body.顧客;
  console.log(`${c.氏名}  入力:${c.郵便番号 || 'なし'}`
    + `  推定:${c.郵便番号推定 || 'なし'}${c.郵便番号推定のもと ? '(' + c.郵便番号推定のもと + ')' : ''}`
    + `  住所:${c.住所 || 'なし'}`);
}
await client.end();
