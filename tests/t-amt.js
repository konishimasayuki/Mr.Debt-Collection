// その回から先の金額を変える
import { client, call, check, done, reset } from './h.js';

(async () => {
  await client.connect();
  await reset();
  await call('setup', { method: 'POST', body: {} });
  const 作る = async (o) => (await call('customers', { method: 'POST', body: o })).body;
  const 見る = async (id) => (await call('customer', { q: { id } })).body;
  const 払う = (id, 日, 額, 種類) => call('payments', { method: 'POST', body: {
    顧客id: id, 日付: 日, 金額: 額, 入金種類: 種類, メモ: '現金で受け取った' } });
  const 変える = (id, o) => call('customer', { method: 'POST', body: {
    id, 種類: '金額変更', ...o } });
  const 予定 = async (id, 種類 = '通常') => (await 見る(id)).支払予定
    .filter((s) => s.種類 === 種類).map((s) => s.請求);

  // 10回 × 30,000円。2回目まで入金済み
  const A = await 作る({ 名前: '額変 太郎', よみ: 'ガクヘン タロウ',
    月々の金額: 30000, 回数: 10, 支払日: 27, 開始月: '2026-09' });
  await 払う(A.id, '2026-09-27', 60000);
  let d = await 見る(A.id);
  check('はじめは支払総額300,000円', d.顧客.支払総額 === 300000, d.顧客.支払総額);
  check('2回目まで入金済み',
    d.支払予定.filter((s) => s.状態 === '入金済み').length === 2,
    d.支払予定.filter((s) => s.状態 === '入金済み').length);

  console.log('■ 3回目から先を20,000円に下げる');
  const r = await 変える(A.id, { 回次: 3, 回の種類: '通常', 新しい金額: 20000,
    メモ: '収入が減ったため、本人と合意' });
  check('変えられる', r.code === 200, r.body);
  check('8回ぶん変わった', r.body.件数 === 8, r.body);
  check('金額の並び',
    (await 予定(A.id)).join(',') === '30000,30000,20000,20000,20000,20000,20000,20000,20000,20000',
    await 予定(A.id));

  console.log('■ 支払総額と残債も合う');
  d = await 見る(A.id);
  check('支払総額は220,000円', d.顧客.支払総額 === 30000 * 2 + 20000 * 8, d.顧客.支払総額);
  check('入金合計は60,000円', d.顧客.入金合計 === 60000, d.顧客.入金合計);
  check('残債は160,000円', d.顧客.残債 === 160000, d.顧客.残債);
  check('月々の金額も20,000円になる', d.顧客.月々の金額 === 20000, d.顧客.月々の金額);
  check('回数は変わらない', d.顧客.回数 === 10, d.顧客.回数);
  check('並びは崩れていない', d.顧客.並びが崩れている === false);

  console.log('■ 払い終えた回は動かない');
  check('1回目は30,000円のまま', (await 予定(A.id))[0] === 30000);
  check('1回目は入金済みのまま',
    (await 見る(A.id)).支払予定[0].状態 === '入金済み');

  console.log('■ 理由は支払いの記録に残る');
  d = await 見る(A.id);
  const メ = d.支払予定.find((s) => s.回次 === 3 && s.種類 === '通常').メモ;
  check('3回目にメモが付く', メ.length >= 1, メ);
  check('前後の金額が読める',
    /30,000円 → 20,000円/.test(メ.map((m) => m.本文).join(' ')),
    メ.map((m) => m.本文));
  check('理由が読める', /収入が減ったため/.test(メ.map((m) => m.本文).join(' ')));

  console.log('■ 入金の入っている回は変えられない');
  const x = await 変える(A.id, { 回次: 1, 回の種類: '通常', 新しい金額: 10000,
    メモ: 'だめなはず' });
  check('400で断る', x.code === 400, x.body);
  check('理由が分かる', /入金の入っている回/.test(x.body.error || ''), x.body);
  check('金額は変わっていない', (await 予定(A.id))[0] === 30000);

  console.log('■ 理由が無ければ断る');
  const y = await 変える(A.id, { 回次: 5, 回の種類: '通常', 新しい金額: 15000 });
  check('400で断る', y.code === 400, y.body);
  check('理由を書けと言う', /理由/.test(y.body.error || ''), y.body);

  console.log('■ 同じ金額なら断る');
  const z = await 変える(A.id, { 回次: 5, 回の種類: '通常', 新しい金額: 20000,
    メモ: '同じ' });
  check('400で断る', z.code === 400, z.body);

  console.log('■ 0や負の数は断る');
  for (const v of [0, -100]) {
    const w = await 変える(A.id, { 回次: 5, 回の種類: '通常', 新しい金額: v, メモ: 'だめ' });
    check(`${v} は断る`, w.code === 400, w.body);
  }

  console.log('■ 上げることもできる');
  await 変える(A.id, { 回次: 8, 回の種類: '通常', 新しい金額: 50000,
    メモ: '本人の希望で早く終わらせる' });
  check('8回目から先が50,000円',
    (await 予定(A.id)).join(',')
      === '30000,30000,20000,20000,20000,20000,20000,50000,50000,50000',
    await 予定(A.id));
  d = await 見る(A.id);
  check('支払総額も合う',
    d.顧客.支払総額 === 30000 * 2 + 20000 * 5 + 50000 * 3, d.顧客.支払総額);

  console.log('■ ボーナスの回も、その回から先だけ変わる');
  const B = await 作る({ 名前: '賞額 花子', よみ: 'ショウガク ハナコ',
    月々の金額: 30000, 回数: 24, 支払日: 27, 開始月: '2026-09' });
  await call('customer', { method: 'PATCH', body: {
    id: B.id, ボーナス月: [7, 12], ボーナス日: 27, ボーナス金額: 100000 } });
  check('賞与は4回', (await 予定(B.id, 'ボーナス')).length === 4,
    await 予定(B.id, 'ボーナス'));
  await 変える(B.id, { 回次: 2, 回の種類: 'ボーナス', 新しい金額: 50000,
    メモ: '賞与が減ったため' });
  check('賞与2から先が50,000円',
    (await 予定(B.id, 'ボーナス')).join(',') === '100000,50000,50000,50000',
    await 予定(B.id, 'ボーナス'));
  check('通常の回は動かない',
    (await 予定(B.id)).every((x2) => x2 === 30000), await 予定(B.id));
  d = await 見る(B.id);
  check('支払総額も合う',
    d.顧客.支払総額 === 30000 * 24 + 100000 + 50000 * 3, d.顧客.支払総額);
  check('1回あたりの賞与額も50,000円', d.顧客.ボーナス金額 === 50000, d.顧客.ボーナス金額);

  console.log('■ 入金の当たり方も金額に合う');
  const C = await 作る({ 名前: '充当 次郎', よみ: 'ジュウトウ ジロウ',
    月々の金額: 30000, 回数: 10, 支払日: 27, 開始月: '2026-09' });
  await 変える(C.id, { 回次: 1, 回の種類: '通常', 新しい金額: 10000, メモ: '下げる' });
  await 払う(C.id, '2026-09-27', 25000);
  d = await 見る(C.id);
  check('1・2回目が入金済み',
    d.支払予定.slice(0, 2).every((s) => s.状態 === '入金済み'),
    d.支払予定.slice(0, 3).map((s) => s.状態));
  check('3回目に5,000円入っている', d.支払予定[2].入金 === 5000, d.支払予定[2].入金);
  check('残債は75,000円', d.顧客.残債 === 10000 * 10 - 25000, d.顧客.残債);

  await client.end();
  done();
})();
