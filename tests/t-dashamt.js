// ダッシュボード：月ごとの予定回収額（％と入れ替えた表示）
import { client, call, check, done, reset } from './h.js';

const 前月 = (n) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

(async () => {
  await client.connect();
  await reset();
  await call('setup', { method: 'POST', body: {} });
  const 作る = async (o) => (await call('customers', { method: 'POST', body: o })).body;
  const 払う = (id, 日, 額) => call('payments', { method: 'POST', body: {
    顧客id: id, 日付: 日, 金額: 額, メモ: '現金で受け取った' } });
  const 見る = async () => (await call('dashboard')).body;
  const 月を引く = (d, ym) => d.月.find((m) => m.年月 === ym);

  // 期日が過ぎている月を作る。2か月前から毎月20日に 30,000円 × 2名
  const 開始 = 前月(2);
  const A = await 作る({ 名前: 'ダッシュ 一郎', よみ: 'ダッシュ イチロウ',
    月々の金額: 30000, 回数: 6, 支払日: 20, 開始月: 開始 });
  const B = await 作る({ 名前: 'ダッシュ 二郎', よみ: 'ダッシュ ジロウ',
    月々の金額: 50000, 回数: 6, 支払日: 20, 開始月: 開始 });

  console.log('■ 率は返さなくなり、予定回収額を返す');
  let d = await 見る();
  const m0 = 月を引く(d, 開始);
  check('その月がある', !!m0, d.月.map((m) => m.年月));
  check('率は返さない', m0.率 === undefined, m0.率);
  check('予定回収額を返す', typeof m0.予定回収額 === 'number', m0.予定回収額);
  check('予定回収額は80,000円', m0.予定回収額 === 80000, m0.予定回収額);
  check('未回収額も80,000円', m0.未回収額 === 80000, m0.未回収額);
  check('全件は2件', m0.全件 === 2, m0.全件);

  console.log('■ 払い終えた回も、予定回収額には足す');
  // 一郎の1回目（30,000円）を払う
  await 払う(A.id, `${開始}-20`, 30000);
  d = await 見る();
  const m1 = 月を引く(d, 開始);
  check('予定回収額は80,000円のまま', m1.予定回収額 === 80000, m1.予定回収額);
  check('未回収額は50,000円に減る', m1.未回収額 === 50000, m1.未回収額);
  check('回収済みは1件', m1.回収済み === 1, m1.回収済み);
  check('全件は2件のまま', m1.全件 === 2, m1.全件);

  console.log('■ ボーナスの回も予定回収額に入る');
  await call('customer', { method: 'PATCH', body: {
    id: B.id, ボーナス月: [Number(開始.slice(5, 7))], ボーナス日: 20,
    ボーナス金額: 100000 } });
  d = await 見る();
  const m2 = 月を引く(d, 開始);
  check('予定回収額は180,000円', m2.予定回収額 === 180000, m2.予定回収額);
  check('全件は3件', m2.全件 === 3, m2.全件);

  console.log('■ 月ごとに分かれている');
  const 翌 = 前月(1);
  const m3 = 月を引く(d, 翌);
  check('翌月もある', !!m3, d.月.map((m) => m.年月));
  check('翌月の予定回収額は80,000円', m3 && m3.予定回収額 === 80000, m3 && m3.予定回収額);

  console.log('■ 引き上げた顧客は予定回収額に入れない');
  await call('customer', { method: 'PATCH', body: {
    id: B.id, 状態: '回収', 状態日: `${開始}-25` } });
  d = await 見る();
  const m4 = 月を引く(d, 開始);
  check('二郎のぶんが抜ける', !m4 || m4.予定回収額 === 30000,
    m4 && m4.予定回収額);

  await client.end();
  done();
})();
