// ボーナスの回数：契約の最終回を越えても、決めた回数ぶんは作る
//
// 「都合により8回になった」ときに7回しか作らないと、
// 払う約束をした15万円が台帳から消える。それは債権の取りこぼしになる。
import { client, call, check, done, reset } from './h.js';

(async () => {
  await client.connect();
  await reset();
  await call('setup', { method: 'POST', body: {} });
  const 作る = async (o) => (await call('customers', { method: 'POST', body: o })).body;
  const 見る = async (id) => (await call('customer', { q: { id } })).body;
  const 直す = (id, o) => call('customer', { method: 'PATCH', body: { id, ...o } });
  const 賞与 = async (id) => (await 見る(id)).支払予定
    .filter((s) => s.種類 === 'ボーナス').map((s) => `${s.回次}:${s.期日}`);

  // ご報告と同じ形。48回・毎月27日・2026-06 から（最終回は 2030-05-27）。
  // 8月と12月に15万円、賞与の開始は 2026-12 → 契約の期間に入るのは7回
  const A = await 作る({ 名前: '賞与 太郎', よみ: 'ショウヨ タロウ',
    月々の金額: 50663, 回数: 48, 支払日: 27, 開始月: '2026-06' });
  await 直す(A.id, { ボーナス月: [8, 12], ボーナス日: 27, ボーナス金額: 150000,
    ボーナス開始月: '2026-12' });
  check('回数を決めなければ7回', (await 賞与(A.id)).length === 7, await 賞与(A.id));
  let d = await 見る(A.id);
  const 最終 = d.支払予定.filter((s) => s.種類 === '通常').slice(-1)[0].期日;
  check('契約の最終回は2030-05-27', 最終 === '2030-05-27', 最終);

  console.log('■ 8回と決めたら8回作る');
  await 直す(A.id, { ボーナス回数: 8 });
  const ら = await 賞与(A.id);
  check('8回できる', ら.length === 8, ら);
  check('8回目は最終回より後の2030-08-27', ら[7] === '8:2030-08-27', ら[7]);
  check('7回目までは変わらない',
    ら.slice(0, 7).join(',') === '1:2026-12-27,2:2027-08-27,3:2027-12-27,4:2028-08-27,'
      + '5:2028-12-27,6:2029-08-27,7:2029-12-27', ら.slice(0, 7));

  console.log('■ 8回目の15万円が請求に足されている');
  d = await 見る(A.id);
  check('支払総額に8回ぶん入る',
    d.顧客.支払総額 === 50663 * 48 + 150000 * 8, d.顧客.支払総額);
  check('残債にも8回ぶん入る',
    d.顧客.残債 === 50663 * 48 + 150000 * 8, d.顧客.残債);
  check('回数の指定が返る', d.顧客.ボーナス回数の指定 === 8, d.顧客.ボーナス回数の指定);
  check('並びは崩れていない', d.顧客.並びが崩れている === false, d.顧客.並びが崩れている);

  console.log('■ もっと先まで決めてもよい');
  await 直す(A.id, { ボーナス回数: 12 });
  const ら2 = await 賞与(A.id);
  check('12回できる', ら2.length === 12, ら2.length);
  check('12回目は2032-08-27', ら2[11] === '12:2032-08-27', ら2[11]);
  d = await 見る(A.id);
  check('支払総額も12回ぶん',
    d.顧客.支払総額 === 50663 * 48 + 150000 * 12, d.顧客.支払総額);

  console.log('■ 空に戻すと、契約の期間ぶんに戻る');
  await 直す(A.id, { ボーナス回数: '' });
  check('7回に戻る', (await 賞与(A.id)).length === 7, await 賞与(A.id));

  console.log('■ 入金の入っている回は、回数を減らしても残る');
  await 直す(A.id, { ボーナス回数: 8 });
  await call('payments', { method: 'POST', body: {
    顧客id: A.id, 日付: '2026-12-27', 金額: 150000, 入金種類: 'ボーナス',
    メモ: '現金で受け取った' } });
  let e = await 見る(A.id);
  const 賞1 = e.支払予定.find((s) => s.種類 === 'ボーナス' && s.回次 === 1);
  check('いちばん古い賞与に入る', 賞1 && 賞1.入金 === 150000, 賞1 && 賞1.入金);
  await 直す(A.id, { ボーナス回数: 0 });
  const ら3 = await 賞与(A.id);
  check('入金のある回は消えない', ら3.some((x) => x.endsWith('2026-12-27')), ら3);

  console.log('■ 賞与を、契約の最終回より後の月へ移せる');
  await reset();
  await call('setup', { method: 'POST', body: {} });
  const B = await 作る({ 名前: '移動 花子', よみ: 'イドウ ハナコ',
    月々の金額: 50000, 回数: 24, 支払日: 27, 開始月: '2026-05' });
  await 直す(B.id, { ボーナス月: [7], ボーナス日: 27, ボーナス金額: 100000 });
  check('賞与は2回', (await 賞与(B.id)).length === 2, await 賞与(B.id));
  // 最終回は 2028-04-27。2029-07 は契約の外だが、移せなければならない
  const r = await call('customer', { method: 'POST', body: {
    id: B.id, 種類: '賞与の移動', 回次: 2, 新しい月: '2029-07',
    メモ: '今年は賞与が出なかったため' } });
  check('契約の最終回より後へ移せる', r.code === 200, r.code, r.body);
  check('2029-07-27 になる',
    (await 賞与(B.id)).some((x) => x.endsWith('2029-07-27')), await 賞与(B.id));
  let f = await 見る(B.id);
  check('金額は変わらない', f.顧客.支払総額 === 50000 * 24 + 100000 * 2, f.顧客.支払総額);

  console.log('■ 契約の初回より前へは戻せない');
  const r2 = await call('customer', { method: 'POST', body: {
    id: B.id, 種類: '賞与の移動', 回次: 1, 新しい月: '2020-07' } });
  check('断られる', r2.code === 400, r2.code);
  check('理由が分かる', /初回/.test(r2.body.error || ''), r2.body.error);

  console.log('■ ずっと先へは移せない（打ち間違い避け）');
  const r3 = await call('customer', { method: 'POST', body: {
    id: B.id, 種類: '賞与の移動', 回次: 1, 新しい月: '2099-07' } });
  check('断られる', r3.code === 400, r3.code);

  await client.end();
  done();
})();
