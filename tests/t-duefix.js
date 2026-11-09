// 期日の壊れ：入金月変更で払い終えた回より前へ戻せないこと／壊れた記録を直せること
//
// 画像で報告された並び
//   1回 09/27 ／ 3回 09/27 ／ 2回 10/27 ／ 4回 10/27 未入金
// は、入金月変更で未払いの回を払い終えた回より前へ戻したときに起きていた。
import { client, call, check, done, reset } from './h.js';

(async () => {
  await client.connect();
  await reset();
  await call('setup', { method: 'POST', body: {} });
  const 作る = async (o) => (await call('customers', { method: 'POST', body: o })).body;
  const 見る = async (id) => (await call('customer', { q: { id } })).body;
  const 払う = (id, 日, 額) => call('payments', { method: 'POST', body: {
    顧客id: id, 日付: 日, 金額: 額, メモ: '現金で受け取った' } });
  const 通常 = async (id) => (await 見る(id)).支払予定
    .filter((s) => s.種類 === '通常').sort((a, b) => a.回次 - b.回次)
    .map((s) => `${s.回次}:${s.期日}`);

  // 月々 40,318円 × 48回、毎月27日、2026-09 から（報告と同じ形）
  const A = await 作る({ 名前: 'バグ 太郎', よみ: 'バグ タロウ',
    月々の金額: 40318, 回数: 48, 支払日: 27, 開始月: '2026-09' });
  await 払う(A.id, '2026-09-26', 40318);   // 1回
  await 払う(A.id, '2026-09-28', 40318);   // 2回

  console.log('■ 払い終えた回より前へは戻せない');
  const x = await call('customer', { method: 'POST', body: {
    id: A.id, 種類: '入金月変更', 新しい月: '2026-09', メモ: '戻してみる' } });
  check('400で断る', x.code === 400, x.code);
  check('理由が分かる', /払い終えた回より前へは戻せません/.test(x.body.error || ''),
    x.body);
  check('いつより後かを出す', /2026-10-27/.test(x.body.error || ''), x.body.error);
  check('期日は動いていない',
    (await 通常(A.id)).slice(0, 4).join(',')
      === '1:2026-09-27,2:2026-10-27,3:2026-11-27,4:2026-12-27',
    (await 通常(A.id)).slice(0, 4));

  console.log('■ 払い終えた回より後へなら、これまでどおり動かせる');
  const y = await call('customer', { method: 'POST', body: {
    id: A.id, 種類: '入金月変更', 新しい月: '2027-01', メモ: '入院のため' } });
  check('動かせる', y.code === 200, y.body);
  check('3回目から先がずれる',
    (await 通常(A.id)).slice(0, 5).join(',')
      === '1:2026-09-27,2:2026-10-27,3:2027-01-27,4:2027-02-27,5:2027-03-27',
    (await 通常(A.id)).slice(0, 5));
  check('壊れたとは言わない', (await 見る(A.id)).顧客.期日が壊れている === false);

  console.log('■ 払い終えた回と同じ月へも戻せない（同じ日に2回ぶんが並ぶ）');
  const z = await call('customer', { method: 'POST', body: {
    id: A.id, 種類: '入金月変更', 新しい月: '2026-10', メモ: 'だめなはず' } });
  check('400で断る', z.code === 400, z.code);

  // ── すでに壊れている記録 ───────────────────────
  console.log('■ 壊れている記録を見つける');
  await reset();
  await call('setup', { method: 'POST', body: {} });
  const B = await 作る({ 名前: 'バグ 花子', よみ: 'バグ ハナコ',
    月々の金額: 40318, 回数: 48, 支払日: 27, 開始月: '2026-09' });
  await 払う(B.id, '2026-09-26', 40318);
  await 払う(B.id, '2026-09-28', 40318);
  // 直せるようにする前の壊れ方を、データベースに直に入れて作る
  await client.query(
    `UPDATE schedule SET due_date = due_date - interval '2 month'
      WHERE customer_id=$1 AND kind='通常' AND no >= 3`, [B.id]);
  await 払う(B.id, '2026-10-27', 40318);

  let d = await 見る(B.id);
  check('壊れていると分かる', d.顧客.期日が壊れている === true, d.顧客.期日が壊れている);
  check('画像と同じ並びになる',
    d.支払予定.slice(0, 4).map((s) => `${s.回次}:${s.期日.slice(5)}`).join(',')
      === '1:09-27,3:09-27,2:10-27,4:10-27',
    d.支払予定.slice(0, 4).map((s) => `${s.回次}:${s.期日.slice(5)}`));
  check('入金済みの回が未入金に見えている',
    d.支払予定[3].状態 === '未入金' && d.支払予定[3].期日 === '2026-10-27',
    [d.支払予定[3].状態, d.支払予定[3].期日]);
  const 前残債 = d.顧客.残債, 前入金 = d.顧客.入金合計;

  console.log('■ 並べ直すと直る');
  const r = await call('customer', { method: 'POST', body: {
    id: B.id, 種類: '期日を並べ直す', メモ: '前へ戻してしまったため' } });
  check('直せる', r.code === 200, r.body);
  check('1回目の期日はそのまま', r.body.初回 === '2026-09-27', r.body.初回);
  d = await 見る(B.id);
  check('壊れていない', d.顧客.期日が壊れている === false);
  check('1か月ずつの並びになる',
    (await 通常(B.id)).slice(0, 5).join(',')
      === '1:2026-09-27,2:2026-10-27,3:2026-11-27,4:2026-12-27,5:2027-01-27',
    (await 通常(B.id)).slice(0, 5));
  check('回次の順と期日の順が合う',
    d.支払予定.filter((s) => s.種類 === '通常').slice(0, 4)
      .map((s) => s.回次).join(',') === '1,2,3,4',
    d.支払予定.filter((s) => s.種類 === '通常').slice(0, 4).map((s) => s.回次));

  console.log('■ お金は1円も動かない');
  check('残債は同じ', d.顧客.残債 === 前残債, [d.顧客.残債, 前残債]);
  check('入金合計は同じ', d.顧客.入金合計 === 前入金, [d.顧客.入金合計, 前入金]);
  check('3回とも入金済みになる',
    d.支払予定.filter((s) => s.状態 === '入金済み').length === 3,
    d.支払予定.filter((s) => s.状態 === '入金済み').length);
  check('並びも崩れていない', d.顧客.並びが崩れている === false);

  console.log('■ 理由を書かないと直せない');
  const な = await call('customer', { method: 'POST', body: {
    id: B.id, 種類: '期日を並べ直す' } });
  check('400で断る', な.code === 400, な.code);
  check('理由を書けと言う', /理由/.test(な.body.error || ''), な.body);

  console.log('■ 壊れていなければ、直す必要はないと言う');
  const も = await call('customer', { method: 'POST', body: {
    id: B.id, 種類: '期日を並べ直す', メモ: 'もう一度' } });
  check('400で断る', も.code === 400, も.code);
  check('壊れていないと言う', /壊れていません/.test(も.body.error || ''), も.body);

  console.log('■ 理由は支払いの記録に残る');
  const メ = d.支払予定.find((s) => s.回次 === 1 && s.種類 === '通常').メモ;
  check('1回目にメモが付く', メ.length >= 1, メ);
  check('理由が読める', /前へ戻してしまったため/.test(メ.map((m) => m.本文).join(' ')),
    メ.map((m) => m.本文));

  console.log('■ ボーナスのある顧客でも直せる');
  await reset();
  await call('setup', { method: 'POST', body: {} });
  const C = await 作る({ 名前: 'バグ 次郎', よみ: 'バグ ジロウ',
    月々の金額: 30000, 回数: 24, 支払日: 27, 開始月: '2026-09' });
  await call('customer', { method: 'PATCH', body: {
    id: C.id, ボーナス月: [7, 12], ボーナス日: 27, ボーナス金額: 100000 } });
  await 払う(C.id, '2026-09-27', 30000);
  await client.query(
    `UPDATE schedule SET due_date = due_date - interval '3 month'
      WHERE customer_id=$1 AND kind='通常' AND no >= 2`, [C.id]);
  check('壊れている', (await 見る(C.id)).顧客.期日が壊れている === true);
  const 賞前 = (await 見る(C.id)).顧客.支払総額;
  const r2 = await call('customer', { method: 'POST', body: {
    id: C.id, 種類: '期日を並べ直す', メモ: '直す' } });
  check('直せる', r2.code === 200, r2.body);
  check('壊れていない', (await 見る(C.id)).顧客.期日が壊れている === false);
  check('支払総額は変わらない', (await 見る(C.id)).顧客.支払総額 === 賞前,
    [(await 見る(C.id)).顧客.支払総額, 賞前]);

  await client.end();
  done();
})();
