// 支払い金額の決まり（偶数回・奇数回・初回・最終回）
// 偶数・奇数は回の番号で数える（期日の月ではない）
import { client, call, check, done, reset } from './h.js';
import { 回の金額 } from '../api/_kimari.js';

(async () => {
  await client.connect();
  await reset();
  await call('setup', { method: 'POST', body: {} });
  const 見る = async (id) => (await call('customer', { q: { id } })).body;
  const 額 = (d) => d.支払予定.filter((s) => s.種類 === '通常').map((s) => s.請求);

  console.log('■ 決まりの強さ（最終回 ＞ 初回 ＞ 偶数回・奇数回 ＞ 基本）');
  check('偶数・奇数は回の番号で数える（2回目が3月でも偶数回）',
    回の金額({ 基本: 1, 偶数回: 2, 奇数回: 3 }, 2, 6, '2027-03-01') === 2);
  check('1回目が2月でも奇数回', 回の金額({ 基本: 1, 偶数回: 2, 奇数回: 3 }, 1, 6, '2027-02-01') === 3);
  const 決 = { 基本: 30000, 偶数回: 40000, 奇数回: 20000, 初回: 50000, 最終回: 10000 };
  check('最終回', 回の金額(決, 6, 6, '2027-06-01') === 10000);
  check('初回', 回の金額(決, 1, 6, '2027-01-01') === 50000);
  check('偶数回', 回の金額(決, 2, 6, '2027-02-01') === 40000);
  check('奇数回', 回の金額(決, 3, 6, '2027-03-01') === 20000);
  check('決まりが無ければ基本', 回の金額({ 基本: 30000 }, 3, 6, '2027-03-01') === 30000);
  check('1回きりなら最終回が勝つ', 回の金額(決, 1, 1, '2027-01-01') === 10000);

  console.log('■ 登録のときに決められる（偶数回A・奇数回B・最終回C）');
  const r = await call('customers', { method: 'POST', body: {
    名前: '決まり 太郎', 月々の金額: 30000, 回数: 6, 支払日: 10, 開始月: '2027-01',
    偶数回: 40000, 奇数回: 30000, 最終回: 10000 } });
  check('登録できる', r.code === 200, r.body);
  const id = r.body.id;
  let d = await 見る(id);
  check('1月30,000 2月40,000 3月30,000 4月40,000 5月30,000 最終回10,000',
    JSON.stringify(額(d)) === JSON.stringify([30000, 40000, 30000, 40000, 30000, 10000]), 額(d));
  check('支払総額は予定の合計 180,000円', d.顧客.支払総額 === 180000, d.顧客.支払総額);
  check('返事の支払総額も合計', r.body.支払総額 === 180000, r.body.支払総額);
  check('決まりを返す', d.顧客.金額の決まり.偶数回 === 40000 && d.顧客.金額の決まり.最終回 === 10000
    && d.顧客.金額の決まり.初回 === null, d.顧客.金額の決まり);
  check('残債も合計から', d.顧客.残債 === 180000, d.顧客.残債);
  const 登 = await client.query(`SELECT text FROM event WHERE customer_id=$1 AND kind='登録'`, [id]);
  check('登録の記録に決まりが残る', /偶数回 40,000円/.test(登.rows[0].text), 登.rows[0].text);

  console.log('■ 2月から始まっても、1回目は奇数回');
  const r3 = await call('customers', { method: 'POST', body: {
    名前: '二月 始', 月々の金額: 30000, 回数: 4, 支払日: 10, 開始月: '2027-02',
    偶数回: 40000, 奇数回: 20000 } });
  d = await 見る(r3.body.id);
  check('1回目(2月)20,000 2回目(3月)40,000 3回目(4月)20,000 4回目(5月)40,000',
    JSON.stringify(額(d)) === '[20000,40000,20000,40000]', 額(d));

  console.log('■ 初回だけ違う額');
  const r2 = await call('customers', { method: 'POST', body: {
    名前: '初回 次郎', 月々の金額: 20000, 回数: 3, 支払日: 1, 開始月: '2027-02', 初回: 25000 } });
  d = await 見る(r2.body.id);
  check('25,000 20,000 20,000', JSON.stringify(額(d)) === '[25000,20000,20000]', 額(d));

  console.log('■ 決まりの金額が正しくなければ断る');
  const 駄 = await call('customers', { method: 'POST', body: {
    名前: '駄目', 月々の金額: 20000, 回数: 3, 支払日: 1, 開始月: '2027-02', 偶数回: -5 } });
  check('断る', 駄.code === 400 && /偶数回/.test(駄.body.error), 駄.body);

  console.log('■ あとから決まりを変えられる（払った回は動かない）');
  // 1回目（30,000）と2回目の一部（10,000）を払う
  await call('payments', { method: 'POST', body: {
    顧客id: id, 日付: '2026-11-01', 金額: 40000, メモ: '検査' } });
  d = await 見る(id);
  check('1回目は入金済み・2回目は一部', d.支払予定[0].状態 === '入金済み'
    && d.支払予定[1].状態 === '一部入金', d.支払予定.slice(0, 2));
  const 理由なし = await call('customer', { method: 'POST', body: {
    id, 種類: '金額の決まり', 基本: 30000, 偶数回: 45000, 奇数回: 25000, 最終回: 10000 } });
  check('理由が無いと断る', 理由なし.code === 400, 理由なし.code);
  const 同じ = await call('customer', { method: 'POST', body: {
    id, 種類: '金額の決まり', 基本: 30000, 偶数回: 40000, 奇数回: 30000, 最終回: 10000, メモ: 'x' } });
  check('同じ決まりなら断る', 同じ.code === 400, 同じ.code);
  const 変 = await call('customer', { method: 'POST', body: {
    id, 種類: '金額の決まり', 基本: 30000, 偶数回: 45000, 奇数回: 25000, 最終回: 10000,
    メモ: 'ボーナス月の都合で見直し' } });
  check('変えられる', 変.code === 200, 変.body);
  d = await 見る(id);
  check('払った1回目と一部の2回目はそのまま／3〜5回目だけ新しい額',
    JSON.stringify(額(d)) === JSON.stringify([30000, 40000, 25000, 45000, 25000, 10000]), 額(d));
  check('書き換えたのは3回・触らなかったのは2回（払い終えた回と一部入金の回）',
    変.body.変えた === 3 && 変.body.飛ばした === 2, 変.body);
  check('支払総額も合計し直す', d.顧客.支払総額 === 175000, d.顧客.支払総額);
  check('入金の合計は変わらない', d.顧客.入金合計 === 40000, d.顧客.入金合計);
  const 記 = await client.query(
    `SELECT text, memo FROM event WHERE customer_id=$1 ORDER BY id DESC LIMIT 1`, [id]);
  check('変えたことと理由が記録に残る', /決まりを変更/.test(記.rows[0].text)
    && 記.rows[0].memo === 'ボーナス月の都合で見直し', 記.rows[0]);
  const メ = d.支払予定[2].メモ || [];
  check('支払いの記録（3回目）にも1行残る', メ.some((m) => /決まりを変更/.test(m.本文 || m.text || '')),
    メ);

  console.log('■ 開始月を動かしても、どの回がいくらかは変わらない（回の番号で数えるため）');
  const 動 = await call('customer', { method: 'PATCH', body: { id, 開始月: '2027-02' } });
  check('動かせる', 動.code === 200, 動.body);
  d = await 見る(id);
  check('額はそのまま',
    JSON.stringify(額(d)) === JSON.stringify([30000, 40000, 25000, 45000, 25000, 10000]), 額(d));
  check('期日は1か月あとへ', d.支払予定[0].期日 === '2027-02-10', d.支払予定[0].期日);
  check('支払総額もそのまま', d.顧客.支払総額 === 175000, d.顧客.支払総額);

  console.log('■ ボーナスを足しても、支払総額は予定の合計');
  await call('customer', { method: 'PATCH', body: {
    id, ボーナス月: [7], ボーナス日: 10, ボーナス金額: 50000 } });
  d = await 見る(id);
  const 予定の合計 = d.支払予定.reduce((a, s) => a + s.請求, 0);
  check('月々×回数ではなく、予定の合計', d.顧客.支払総額 === 予定の合計, [d.顧客.支払総額, 予定の合計]);

  console.log('■ 「その回から先の金額を変える」でそろえたら、決まりは外す');
  await call('customer', { method: 'POST', body: {
    id, 種類: '金額変更', 回次: 3, 回の種類: '通常', 新しい金額: 20000, メモ: '一律に下げる' } });
  d = await 見る(id);
  check('3回目から先は20,000円', JSON.stringify(額(d).slice(2)) === '[20000,20000,20000,20000]', 額(d));
  check('決まりは外れている', d.顧客.金額の決まり.偶数回 === null && d.顧客.金額の決まり.最終回 === null,
    d.顧客.金額の決まり);
  await call('customer', { method: 'PATCH', body: { id, 開始月: '2027-03' } });
  d = await 見る(id);
  check('開始月を動かしても、そろえた額は戻らない',
    JSON.stringify(額(d).slice(2)) === '[20000,20000,20000,20000]', 額(d));

  await done();
})();
