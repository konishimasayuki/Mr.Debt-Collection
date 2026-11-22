// 未払い顧客の振り分けと、請求書の発行者の設定
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
  const 作る = async (名, 額, 開始, 他 = {}) => (await call('customers', { method: 'POST', body: {
    名前: 名, 月々の金額: 額, 回数: 24, 支払日: 1, 開始月: 開始, ...他 } })).body;
  const 一覧 = async () => (await call('customers', { q: { 未払い顧客: 1 } })).body.顧客;
  const 人 = async (名) => (await 一覧()).find((r) => r.氏名 === 名);

  console.log('■ 何か月分たまっているかで分ける');
  await 作る('一か月', 30000, 前月(0), { 車種: 'ムーヴ' });
  const 二 = await 作る('二か月', 50000, 前月(2));
  await call('payments', { method: 'POST', body: {
    顧客id: 二.id, 日付: `${前月(2)}-01`, 金額: 50000, メモ: '1回目' } });
  await 作る('四か月', 20000, 前月(3));
  let r = await 人('一か月');
  check('1か月分', r && r.区分 === '1か月分' && r.滞納月数 === 1, r);
  check('未払い額は過ぎた回の残り', r && r.未払い額 === 30000, r && r.未払い額);
  check('車両が出る', r && r.車種 === 'ムーヴ', r && r.車種);
  check('残債額が出る', r && r.残債金額 === 720000, r && r.残債金額);
  r = await 人('二か月');
  check('払った回は数えない（3回のうち2回）', r && r.区分 === '2か月分' && r.滞納月数 === 2, r);
  check('未払い額 100,000円', r && r.未払い額 === 100000, r && r.未払い額);
  r = await 人('四か月');
  check('3か月分以上にまとめる', r && r.区分 === '3か月分以上' && r.滞納月数 === 4, r);

  console.log('■ 一部だけ入っている回は、残りだけを数える');
  const 部 = await 作る('一部', 30000, 前月(0));
  await call('payments', { method: 'POST', body: {
    顧客id: 部.id, 日付: `${前月(0)}-01`, 金額: 10000, メモ: '一部' } });
  r = await 人('一部');
  check('まだ1か月分', r && r.滞納月数 === 1, r);
  check('未払い額は残りの20,000円', r && r.未払い額 === 20000, r && r.未払い額);

  console.log('■ エンジンストップは、滞納が無くても出す');
  const 停 = await 作る('停止', 40000, 前月(-1));
  await call('customer', { method: 'PATCH', body: { id: 停.id, 状態: 'エンジンストップ' } });
  r = await 人('停止');
  check('エンジンストップの欄に出る', r && r.区分 === 'エンジンストップ', r);
  check('未払い額は0円', r && r.未払い額 === 0, r && r.未払い額);
  console.log('■ エンジンストップの人は、月数の欄には出さない（2か所に出さない）');
  const 停2 = await 作る('停止で滞納', 40000, 前月(1));
  await call('customer', { method: 'PATCH', body: { id: 停2.id, 状態: 'エンジンストップ' } });
  const 全 = await 一覧();
  check('1回だけ出る', 全.filter((x) => x.氏名 === '停止で滞納').length === 1);
  check('エンジンストップの欄', 全.find((x) => x.氏名 === '停止で滞納').区分 === 'エンジンストップ');

  console.log('■ 出さない人');
  await 作る('まだ', 10000, 前月(-1));
  const 引 = await 作る('引き上げ', 10000, 前月(2));
  await call('customer', { method: 'PATCH', body: { id: 引.id, 状態: '回収' } });
  check('期日が来ていない人は出さない', !(await 人('まだ')));
  check('引き上げた人は出さない', !(await 人('引き上げ')));

  console.log('■ 請求書の発行者。はじめは MIAMIホールディングス');
  let c = (await call('companies')).body;
  check('既定の名称', c.請求書の発行者 && c.請求書の発行者.名称 === 'MIAMIホールディングス',
    c.請求書の発行者);
  check('債権会社の一覧も今までどおり', Array.isArray(c.会社), c);

  console.log('■ テナントごとに変えられる');
  const u = await call('companies', { method: 'PATCH', body: { 請求書の発行者: {
    名称: '株式会社テスト商会', 住所: '福岡県久留米市東町1-1', 郵便番号: '830-0032',
    電話番号: '0942-00-0000', 振込先: '◯◯銀行 本店 普通 1234567', 登録番号: '' } } });
  check('保存できる', u.code === 200, u.body);
  c = (await call('companies')).body;
  check('名称が変わる', c.請求書の発行者.名称 === '株式会社テスト商会', c.請求書の発行者);
  check('振込先も残る', c.請求書の発行者.振込先 === '◯◯銀行 本店 普通 1234567');
  const 駄 = await call('companies', { method: 'PATCH', body: { 請求書の発行者: { 名称: '  ' } } });
  check('会社名が空なら断る', 駄.code === 400, 駄.code);
  c = (await call('companies')).body;
  check('断ったので前のまま', c.請求書の発行者.名称 === '株式会社テスト商会');
  const 記 = await client.query(`SELECT text FROM event WHERE kind='設定' ORDER BY id DESC LIMIT 1`);
  check('変えたことが記録に残る', /請求書の発行者/.test(記.rows[0].text), 記.rows[0]);

  await done();
})();
