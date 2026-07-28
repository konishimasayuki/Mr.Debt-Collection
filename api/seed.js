// 既存54件の契約と支払予定をデータベースへ入れる(移行の第1・2段)。
// 何度実行しても増えない(氏名で照合し、すでに居れば飛ばす)。
//
// 元データの扱い:
//  - 支払予定(期日・月額)は CSV「支払予定明細_2026-07時点」から。検算済み
//  - ボーナス見込みは CSV ではなく引き継ぎ資料の数字を採用。
//    CSV は ADR-002 より前の生成物で、8件のボーナスが欠けている(合計 3,359,766円)。
//    該当の8件には「要確認」の記録を残す(B-1)。
//  - 予定額は毎月額のみ。ボーナス加算は含めない(ADR-002)
const { requireSession, recordedBy } = require('./_auth');
const { db, fail, ok } = require('./_db');
const CONTRACTS = require('./data/contracts.json');

// 回次kの支払期日(初回日から月を足す。CSV全2,592行と一致することを確認済み)
function dueOf(start, k) {
  const [y, m, d] = start.split('-').map(Number);
  const t = y * 12 + (m - 1) + (k - 1);
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

module.exports = async (req, res) => {
  if (!requireSession(req, res)) return;
  const who = recordedBy(req);
  try {
    const sql = db();
    let added = 0, skipped = 0, schedules = 0, flagged = 0;

    for (const c of CONTRACTS) {
      const exists = await sql('SELECT id FROM contract WHERE name = $1', [c.name]);
      if (exists.length) { skipped++; continue; }

      const ins = await sql(
        `INSERT INTO contract
           (name, car, purchase_amount, fee_amount, total_amount, monthly_amount,
            term_count, pay_day, start_date, bonus_remaining, balance_diff, status, memo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [c.name, c.car, c.purchase, c.fee, c.total, c.monthly,
         c.term, c.pay_day, c.start, c.bonus, c.diff,
         c.kaishu ? '回収' : '通常', c.note || null]);
      const id = ins[0].id;
      added++;

      // 支払予定。予定額は毎月額のみ(ADR-002)
      for (let k = 1; k <= c.term; k++) {
        await sql(
          `INSERT INTO schedule (contract_id, no, due_date, planned_amount)
           VALUES ($1,$2,$3,$4) ON CONFLICT (contract_id, no) DO NOTHING`,
          [id, k, dueOf(c.start, k), c.monthly]);
        schedules++;
      }

      // 移行したこと自体を記録に残す
      await sql(
        `INSERT INTO event (contract_id, no, recorded_by, kind, text, memo)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, 1, who, 'メモ',
         `移行:${c.sheet}シートから取り込み（毎月 ${c.monthly.toLocaleString()}円 × ${c.term}回）`,
         c.note || null]);

      // CSVと資料でボーナスが食い違う契約は、決着するまで記録に残す(B-1)
      if (c.bonus !== c.bonus_csv) {
        flagged++;
        await sql(
          `INSERT INTO event (contract_id, no, recorded_by, kind, text, memo)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, 1, who, 'メモ',
           `要確認:ボーナスの見込み額が資料とCSVで食い違う（資料 ${c.bonus.toLocaleString()}円 / CSV ${c.bonus_csv.toLocaleString()}円）`,
           '資料側の金額で登録した。ボーナス月が未確定（open-questions B-1）']);
      }
    }

    const n = await sql(
      `SELECT (SELECT count(*)::int FROM contract) AS 契約,
              (SELECT count(*)::int FROM schedule) AS 支払予定,
              (SELECT count(*)::int FROM event)    AS 記録,
              (SELECT coalesce(sum(monthly_amount),0)::int FROM contract) AS 毎月額合計,
              (SELECT coalesce(sum(total_amount),0)::bigint FROM contract) AS 支払総額,
              (SELECT coalesce(sum(bonus_remaining),0)::int FROM contract) AS ボーナス見込み`);

    ok(res, {
      done: true,
      入れた契約: added, すでに居た契約: skipped,
      作った支払予定: schedules, 要確認の記録: flagged,
      いまの中身: n[0],
      照合: {
        毎月額合計: n[0].毎月額合計 === 2442001 ? '資料と一致' : '不一致',
        支払総額: Number(n[0].支払総額) === 124584054 ? '資料と一致' : '不一致',
        ボーナス見込み: n[0].ボーナス見込み === 7368006 ? '資料と一致' : '不一致',
      },
    });
  } catch (e) {
    fail(res, e, 'seed');
  }
};
