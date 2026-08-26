// ボーナスの回数の増減と、賞与の回を別の月へ移す
import { client, call, check, done, reset } from './h.js';
const 行 = async (q, p) => (await client.query(q, p || [])).rows;

(async () => {
  await client.connect();
  await reset();
  await call('setup', { method: 'POST', body: {} });
  const 作る = async (o) => (await call('customers', { method: 'POST', body: o })).body;
  const 見る = async (id) => (await call('customer', { q: { id } })).body;
  const 直す = (id, o) => call('customer', { method: 'PATCH', body: { id, ...o } });
  const 賞与 = async (id) => (await 見る(id)).支払予定
    .filter((s) => s.種類 === 'ボーナス').map((s) => `${s.回次}:${s.期日}`);

  // 2026-05 から48回、毎月27日。7月と12月にボーナス10万円 → 全部で8回
  const A = await 作る({ 名前: '賞与 太郎', よみ: 'ショウヨ タロウ',
    月々の金額: 50000, 回数: 48, 支払日: 27, 開始月: '2026-05' });
  await 直す(A.id, { ボーナス月: [7, 12], ボーナス日: 27, ボーナス金額: 100000 });
  check('はじめは8回', (await 賞与(A.id)).length === 8, await 賞与(A.id));

  console.log('■ ボーナスの回数を減らす');
  await 直す(A.id, { ボーナス回数: 5 });
  check('5回になる', (await 賞与(A.id)).length === 5, await 賞与(A.id));
  check('古いほうから5回',
    (await 賞与(A.id)).join(',')
      === '1:2026-07-27,2:2026-12-27,3:2027-07-27,4:2027-12-27,5:2028-07-27',
    await 賞与(A.id));
  let d = await 見る(A.id);
  check('回数の指定が返る', d.顧客.ボーナス回数の指定 === 5, d.顧客.ボーナス回数の指定);
  check('支払総額も5回ぶん', d.顧客.支払総額 === 50000 * 48 + 100000 * 5, d.顧客.支払総額);

  console.log('■ 増やせる');
  await 直す(A.id, { ボーナス回数: 7 });
  check('7回になる', (await 賞与(A.id)).length === 7, await 賞与(A.id));

  console.log('■ 空にすると、契約の期間ぶん全部に戻る');
  await 直す(A.id, { ボーナス回数: '' });
  check('8回に戻る', (await 賞与(A.id)).length === 8, await 賞与(A.id));
  check('指定は空で返る', (await 見る(A.id)).顧客.ボーナス回数の指定 === '');

  console.log('■ おかしな回数は断る');
  const 零 = await 直す(A.id, { ボーナス回数: 0 });
  check('0は400', 零.code === 400, 零.body);
  const 負 = await 直す(A.id, { ボーナス回数: -3 });
  check('負の数は400', 負.code === 400, 負.body);

  console.log('■ 開始月と回数を一緒に使える');
  await 直す(A.id, { ボーナス開始月: '2027-01', ボーナス回数: 3 });
  check('2027年から3回',
    (await 賞与(A.id)).join(',') === '1:2027-07-27,2:2027-12-27,3:2028-07-27',
    await 賞与(A.id));
  await 直す(A.id, { ボーナス開始月: '', ボーナス回数: '' });

  // ── 賞与の移動 ───────────────────────
  console.log('■ 賞与を別の月へ移す');
  const 移 = (id, o) => call('customer', { method: 'POST', body: { id, 種類: '賞与の移動', ...o } });
  const r = await 移(A.id, { 回次: 1, 新しい月: '2026-09', メモ: '今年は賞与が出ないため' });
  check('移せる', r.body.done === true && r.body.後 === '2026-09-27', r.body);
  check('賞与1が9月になる',
    (await 賞与(A.id))[0] === '1:2026-09-27', await 賞与(A.id));
  check('ほかの賞与は動かない',
    (await 賞与(A.id))[1] === '2:2026-12-27', await 賞与(A.id));
  check('記録に残る',
    (await 行(`SELECT count(*)::int n FROM event
                WHERE customer_id=$1 AND text LIKE '%賞与1の期日を%'`, [A.id]))[0].n === 1);
  check('理由も残る',
    (await 行(`SELECT memo FROM event WHERE customer_id=$1 AND text LIKE '%賞与1の期日を%'`,
      [A.id]))[0].memo === '今年は賞与が出ないため');

  console.log('■ 追い越したら、番号を振り直す');
  await 移(A.id, { 回次: 1, 新しい月: '2027-02' });
  const ba = await 賞与(A.id);
  check('12月ぶんが賞与1になる', ba[0] === '1:2026-12-27', ba);
  check('移したほうが賞与2になる', ba[1] === '2:2027-02-27', ba);
  check('期日は古い順に並ぶ',
    ba.map((x) => x.split(':')[1]).join(',')
      === [...ba.map((x) => x.split(':')[1])].sort().join(','), ba);

  console.log('■ 入金は付いていく');
  await call('payments', { method: 'POST', body: {
    日付: '2026-12-27', 金額: 100000, 顧客id: A.id, 入金種類: 'ボーナス', メモ: '賞与' } });
  d = await 見る(A.id);
  check('賞与1が入金済み',
    d.支払予定.find((s) => s.種類 === 'ボーナス' && s.回次 === 1).状態 === '入金済み');
  await 移(A.id, { 回次: 1, 新しい月: '2027-01' });
  d = await 見る(A.id);
  const 移った = d.支払予定.find((s) => s.種類 === 'ボーナス' && s.期日 === '2027-01-27');
  check('移した先も入金済みのまま', 移った && 移った.入金 === 100000, 移った);
  check('残債は変わらない', d.顧客.残債 === d.顧客.支払総額 - 100000, d.顧客.残債);

  console.log('■ 回のメモも一緒に付け替わる');
  const B = await 作る({ 名前: 'メモ 花子', よみ: 'メモ ハナコ',
    月々の金額: 30000, 回数: 36, 支払日: 27, 開始月: '2026-01' });
  await 直す(B.id, { ボーナス月: [3, 9], ボーナス日: 10, ボーナス金額: 50000 });
  await call('customer', { method: 'POST', body: {
    id: B.id, 種類: '回メモ', 回次: 1, 回の種類: 'ボーナス', 本文: '賞与1のメモ' } });
  // 賞与1（3月）を、賞与2（9月）より後ろへ move → 番号が入れ替わる
  await 移(B.id, { 回次: 1, 新しい月: '2026-11' });
  const db = await 見る(B.id);
  const 賞1 = db.支払予定.find((s) => s.種類 === 'ボーナス' && s.回次 === 1);
  const 賞2 = db.支払予定.find((s) => s.種類 === 'ボーナス' && s.回次 === 2);
  check('9月ぶんが賞与1になる', 賞1.期日 === '2026-09-10', 賞1);
  check('移したほうが賞与2になる', 賞2.期日 === '2026-11-10', 賞2);
  check('メモも移したほうに付いている',
    賞2.メモ.some((m) => m.本文 === '賞与1のメモ'), [賞1.メモ, 賞2.メモ]);
  check('元の番号のほうにメモは残っていない',
    !賞1.メモ.some((m) => m.本文 === '賞与1のメモ'), 賞1.メモ);

  console.log('■ 断るところ');
  const 同 = await 移(A.id, { 回次: 1, 新しい月: '2027-01' });
  check('同じ月なら400', 同.code === 400, 同.body);
  const 形 = await 移(A.id, { 回次: 1, 新しい月: '2027/01' });
  check('形が違えば400', 形.code === 400, 形.body);
  const 無 = await 移(A.id, { 回次: 99, 新しい月: '2027-03' });
  check('いない回は400', 無.code === 400, 無.body);
  // 最終回より後へは移せる（賞与が出なかった年の繰り越し）。
  // 前へは戻せない。まだ始まっていない月には置けない
  const 前 = await 移(A.id, { 回次: 1, 新しい月: '2020-01' });
  check('契約の初回より前は400', 前.code === 400, 前.body);
  check('理由が分かる', String(前.body.error).includes('初回'), 前.body);
  const 遠 = await 移(A.id, { 回次: 1, 新しい月: '2099-01' });
  check('ずっと先も400', 遠.code === 400, 遠.body);
  const 重 = await 移(A.id, { 回次: 1, 新しい月: '2027-07' });
  check('同じ日に賞与があれば400', 重.code === 400, 重.body);

  console.log('■ お金の決めごと');
  const 超過 = await 行(`
    SELECT s.id FROM schedule s JOIN allocation a ON a.schedule_id = s.id
     GROUP BY s.id, s.planned_amount HAVING sum(a.amount) > s.planned_amount`);
  check('1回の予定を超えて充当していない', 超過.length === 0, 超過);
  const 番 = await 行(`
    SELECT customer_id, kind, no, count(*) FROM schedule
     GROUP BY customer_id, kind, no HAVING count(*) > 1`);
  check('回の番号がぶつかっていない', 番.length === 0, 番);

  await done();
})();
