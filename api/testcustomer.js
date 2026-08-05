// 動作を試すための顧客(テストレコード)。
// 本物の顧客で練習させないために置く。入金・約束・メモ・CSVの取込を、
// ここで好きなだけ試して、おかしくなったら作り直せばよい。
//
// GET    /api/testcustomer … 今あるか
// POST   /api/testcustomer … 作り直す(古いものは消してから作る)
// DELETE /api/testcustomer … 消す
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { dueOf, yen, norm, makeSchedule, allocate } from './_lib.js';

const bad = (res, msg, why) => {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(JSON.stringify(why ? { error: msg, 理由: why } : { error: msg }));
};

// 決め打ちの中身。毎回同じものが出来るようにする。
// 実在しそうな氏名・電話番号は使わない。
const 名前 = 'テスト 太郎';
const よみ = 'テスト タロウ';
const 月額 = 30000;
const 回数 = 12;
const 支払日 = 27;
const さかのぼる月数 = 3;   // 何回か期日を過ぎた状態にして、未入金にも出るようにする

// n ヶ月前の年と月
const 前の月 = (n) => {
  const d = new Date();
  const t = d.getFullYear() * 12 + d.getMonth() - n;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
};
const 日付を足す = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// 今あるテスト顧客を、ぶら下がっているものごと消す。
// 入金は顧客を消しても残る(customer_id が空になるだけ)ので、先に消す。
// 記録(event)は追記のみだが、テスト顧客のものだけは消せるようにしてある。
// ただし顧客の行を消したあとでは消せないので、必ずこの順で消す。
async function 片づける(sql) {
  const rows = await sql('SELECT id FROM customer WHERE is_test = true');
  for (const r of rows) {
    await sql('DELETE FROM payment WHERE customer_id=$1', [r.id]);
    await sql('DELETE FROM event WHERE customer_id=$1', [r.id]);
    await sql('DELETE FROM customer WHERE id=$1', [r.id]);
  }
  return rows.length;
}

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  const method = (req.method || 'GET').toUpperCase();

  try {
    const sql = db();

    if (method === 'GET') {
      const r = await sql(
        'SELECT id, name FROM customer WHERE is_test = true ORDER BY id LIMIT 1');
      return ok(res, { ある: !!r.length, id: r.length ? r[0].id : null,
        氏名: r.length ? r[0].name : '' });
    }

    if (method === 'DELETE') {
      const 消した = await 片づける(sql);
      return ok(res, { done: true, 消した件数: 消した });
    }

    if (method !== 'POST') return bad(res, '対応していない操作です。');

    // ── 作り直す ────────────────────────────
    const who = recordedBy(req);
    await 片づける(sql);

    const { y: y0, m: m0 } = 前の月(さかのぼる月数);
    const 初回 = dueOf(y0, m0, 支払日, 1);
    const 最終回 = dueOf(y0, m0, 支払日, 回数);
    const 契約 = 前の月(さかのぼる月数 + 1);
    const 契約日 = `${契約.y}-${String(契約.m).padStart(2, '0')}-01`;

    // 会社は設定に登録済みのものがあれば、いちばん最初のものを当てておく
    const co = await sql('SELECT id FROM company ORDER BY id LIMIT 1');

    const id = (await sql(
      `INSERT INTO customer
         (name, kana, gender, birthday, address, tel, contract_date, car,
          assignor_id, monthly_amount, term_count, pay_day,
          start_date, total_amount, memo, is_test)
       VALUES ($1,$2,'男性','1990-01-01',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
       RETURNING id`,
      [名前, よみ,
       '（動作確認用のため、実在しません）', '000-0000-0000',
       契約日, 'テスト車（動作確認用）',
       co.length ? co[0].id : null,
       月額, 回数, 支払日, 初回, 月額 * 回数,
       '動作を試すための顧客です。自由に入金・約束・メモを入れて構いません。'
       + '設定タブから、いつでも作り直せます。']))[0].id;

    await makeSchedule(sql, id, y0, m0, 支払日, 回数, 月額);

    // CSVの取込も試せるように、振込人名を1つ覚えさせておく
    await sql(`INSERT INTO payer_alias (normalized_name, customer_id, created_by)
               VALUES ($1,$2,$3) ON CONFLICT (normalized_name) DO UPDATE
               SET customer_id = EXCLUDED.customer_id`, [norm(よみ), id, who]);

    // 1回目は満額、2回目は一部だけ。3つの状態(入金済み・一部入金・未入金)が
    // そろっていないと、画面の見え方を確かめられない。
    const 入金 = [
      { 日: 初回, 額: 月額, メモ: '動作確認用：1回目を満額' },
      { 日: dueOf(y0, m0, 支払日, 2), 額: 10000, メモ: '動作確認用：2回目を一部だけ' },
    ];
    for (const p of 入金) {
      const pay = (await sql(
        `INSERT INTO payment (customer_id, paid_on, amount, method, source, memo, recorded_by)
         VALUES ($1,$2,$3,'振込','手動',$4,$5) RETURNING id`,
        [id, p.日, p.額, p.メモ, who]))[0];
      await allocate(sql, id, pay.id, p.額);
    }

    // 入金約束を1件。カレンダーと、回ごとのメモの出方を確かめられる
    const 約束日 = 日付を足す(new Date().toISOString().slice(0, 10), 3);
    await sql(
      `INSERT INTO promise (customer_id, promised_on, until_time, schedule_no,
                            amount, memo, created_by)
       VALUES ($1,$2,'17:00',2,$3,$4,$5)`,
      [id, 約束日, 月額 - 10000, '動作確認用の約束です', who]);
    await sql(
      `INSERT INTO schedule_memo (customer_id, schedule_no, text, auto, created_by)
       VALUES ($1,2,$2,true,$3)`,
      [id, `入金約束：${約束日} 17:00までに ${yen(月額 - 10000)}円`, who]);
    await sql(
      `INSERT INTO schedule_memo (customer_id, schedule_no, text, auto, created_by)
       VALUES ($1,2,$2,false,$3)`,
      [id, 'このメモは動作確認用です。編集・削除を試せます。', who]);

    await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
               VALUES ($1,$2,'登録',$3,$4)`,
      [id, who,
       `動作を試すための顧客を用意した：月々 ${yen(月額)}円 × ${回数}回、${初回} から ${最終回} まで`,
       '設定タブから作り直し・削除ができます']);

    return ok(res, { done: true, id, 氏名: 名前, 初回, 最終回,
      支払総額: 月額 * 回数, 約束日 });
  } catch (e) {
    fail(res, e, 'testcustomer');
  }
};
