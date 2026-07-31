// テーブルの作成と、既存データの載せ替え。
// POST /api/setup                 … テーブルを作る（何度実行しても同じ結果）
// POST /api/setup {載せ替え:true} … 旧台帳のデータを新しい形へ入れる
//
// 載せ替えは氏名で照合し、すでに居れば飛ばす。何度実行しても増えない。
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { STATEMENTS } from './_schema.js';
import { readBody, dueOf, yen, makeSchedule } from './_lib.js';
import OLD from './data/contracts.json' with { type: 'json' };

// 旧台帳のテーブル。新しい台帳と名前が重なるものが多い。
const 旧テーブル = ['contract', 'schedule', 'payment', 'allocation',
                    'promise', 'payer_alias', 'event'];

const ある = async (sql, schema, name) => (await sql(
  `SELECT 1 FROM information_schema.tables
    WHERE table_schema=$1 AND table_name=$2`, [schema, name])).length > 0;

// 旧台帳が残っていれば old_ledger スキーマへ移す。消さない。
// contract は旧台帳にしかないので、これがあるかどうかで見分ける。
// 何度呼んでも安全（二度目は contract が public に無いので何もしない）。
async function moveOldTables(sql) {
  if (!(await ある(sql, 'public', 'contract'))) return [];
  await sql('CREATE SCHEMA IF NOT EXISTS old_ledger');
  const 移した = [];
  for (const t of 旧テーブル) {
    if (!(await ある(sql, 'public', t))) continue;
    if (await ある(sql, 'old_ledger', t)) continue;   // すでに退避済み
    await sql(`ALTER TABLE public.${t} SET SCHEMA old_ledger`);
    移した.push(t);
  }
  return 移した;
}

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  if ((req.method || '').toUpperCase() !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'POSTで送ってください。' }));
  }
  const who = recordedBy(req);

  try {
    const sql = db();
    const b = await readBody(req);

    // ── 旧台帳のテーブルを退避する ───────────────
    // schedule・payment などは新旧で名前が同じで中身が違う。残っていると
    // IF NOT EXISTS が読み飛ばし、新しい列に索引を張るところで落ちる。
    // 手で入れたオープニングが入っているので、消さずに別のスキーマへ移す。
    const 退避 = await moveOldTables(sql);

    // ── テーブルを作る ─────────────────────────
    let 作った = 0;
    for (const stmt of STATEMENTS) { await sql(stmt); 作った++; }

    if (!b['載せ替え']) {
      return ok(res, { done: true, 実行した文: 作った,
        ...(退避.length ? {
          退避した旧テーブル: 退避,
          退避先: 'old_ledger スキーマ（消していません）',
        } : {}),
        次に: '「既存データを載せ替える」を押すと、旧台帳の顧客が入ります。' });
    }

    // ── 既存データの載せ替え ────────────────────
    // 旧台帳に債権会社の情報は無いので、勝手には当てない。
    // 設定タブで会社を登録してから、顧客ページで選び直してもらう。
    let 追加 = 0, 飛ばした = 0, 予定 = 0;
    for (const c of OLD) {
      const exists = await sql('SELECT id FROM customer WHERE name=$1', [c.name]);
      if (exists.length) { 飛ばした++; continue; }

      const [y0, m0] = String(c.start).split('-').map(Number);
      const term = c.term || 48;
      const payDay = c.pay_day || 27;
      // 旧台帳の総額はボーナス加算を含むため、新しい台帳では月額×回数で入れ直す
      const total = c.monthly * term;

      const ins = await sql(
        `INSERT INTO customer (name, car, monthly_amount, term_count, pay_day,
                               start_date, total_amount, memo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [c.name, c.car || null, c.monthly, term, payDay,
         dueOf(y0, m0, payDay, 1), total,
         [c.note || null,
          c.kaishu ? '旧台帳で「回収」あつかい' : null,
          c.bonus ? `旧台帳のボーナス見込み ${yen(c.bonus)}円（新しい台帳は月額のみで管理）` : null,
         ].filter(Boolean).join(' / ') || null]);
      const id = ins[0].id;
      追加++;

      予定 += await makeSchedule(sql, id, y0, m0, payDay, term, c.monthly);
      await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                 VALUES ($1,$2,'登録',$3,$4)`,
        [id, who, `旧台帳から載せ替え：月々 ${yen(c.monthly)}円 × ${term}回`,
         '債権譲渡会社・債権譲渡先・よみ・連絡先は未設定です。顧客ページで入れてください。']);
    }

    return ok(res, { done: true, 実行した文: 作った,
      追加した顧客: 追加, すでに居た顧客: 飛ばした, 作った支払予定: 予定,
      ...(退避.length ? {
        退避した旧テーブル: 退避,
        退避先: 'old_ledger スキーマ（消していません）',
      } : {}),
      注意: '旧台帳に無い項目（債権譲渡会社・債権譲渡先・よみ・性別・生年月日・住所・電話番号・契約日）は'
        + '空のままです。設定タブで会社を登録してから、顧客ページで選んでください。' });
  } catch (e) {
    fail(res, e, 'setup');
  }
};
