// 画面が使う形でデータベースの中身を返す。
// 画面側の作りを変えずに済むよう、いまの DATA / HIST / PROMISES と同じ形にそろえる。
const { requireSession } = require('./_auth');
const { db, fail, ok } = require('./_db');

const pad = (n) => String(n).padStart(2, '0');
const md  = (d) => `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const ym  = (d) => d.getUTCFullYear() * 12 + d.getUTCMonth();

// 画面と同じ12ヶ月の並び(今月を6番目に置く)
function monthsAround(today) {
  const base = today.getUTCFullYear() * 12 + today.getUTCMonth() - 5;
  return Array.from({ length: 12 }, (_, i) => ({
    y: Math.floor((base + i) / 12), m: (base + i) % 12 + 1, t: base + i,
  }));
}

module.exports = async (req, res) => {
  if (!requireSession(req, res)) return;
  try {
    const sql = db();
    const today = new Date();
    const todayMd = md(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())));
    const MONTHS = monthsAround(new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)));

    const contracts = await sql(`SELECT * FROM contract ORDER BY id`);
    const schedules = await sql(
      `SELECT contract_id, no, due_date, planned_amount, state FROM schedule ORDER BY contract_id, no`);
    const promises  = await sql(
      `SELECT contract_id, heard_on, promised_on, amount, memo FROM promise ORDER BY id`);
    const events    = await sql(
      `SELECT contract_id, no, occurred_at, recorded_by, kind, text, memo
         FROM event ORDER BY id`);

    const byContract = {};
    schedules.forEach((s) => (byContract[s.contract_id] = byContract[s.contract_id] || []).push(s));

    const DATA = [], HIST = {};

    for (const c of contracts) {
      const rows = byContract[c.id] || [];
      const paidCount = rows.filter((s) => s.state === '入金済み').length;
      // いま追いかけている回 = 未入金のうち最も古いもの
      const current = rows.find((s) => s.state !== '入金済み') || rows[rows.length - 1];
      const no = current ? current.no : c.term_count;
      const due = current ? md(new Date(current.due_date)) : todayMd;

      const moto = Math.round(c.monthly_amount * 0.75);
      const fee  = c.monthly_amount - moto;
      const startT = rows.length ? ym(new Date(rows[0].due_date)) : MONTHS[0].t;

      DATA.push({
        id: c.id,
        due,
        name: c.name,
        kana: c.kana || '',
        ct: c.car || '',
        dt: `元本 ${moto.toLocaleString()} / 手数料 ${fee.toLocaleString()}`,
        amount: c.monthly_amount,
        method: '振込',
        note: c.memo || '',
        memo: c.memo || '',
        parts: [['元本相当', moto], ['手数料相当', fee]],
        n: `${no}/${c.term_count}`,
        paid0: false,                       // 今回ぶんの入金はこれから記録する
        kaishu: c.status === '回収',
        diff: c.balance_diff,
        no,
        rest: c.term_count - no,
        si: Math.max(0, startT - MONTHS[0].t),
        debt: c.total_amount - c.monthly_amount * paidCount,
        bonus: c.bonus_remaining,
        bonusPaid: 0,
        term: c.term_count,
      });

      // 12ヶ月ぶんの状態。予定の実際の期日で並べる
      HIST[c.id] = MONTHS.map((mo) => {
        const s = rows.find((r) => ym(new Date(r.due_date)) === mo.t);
        if (!s) return 'none';                                  // 契約前 / 完済後
        if (s.state === '入金済み') return 'paid';
        if (mo.t === MONTHS[5].t) return 'live';                // 今月は画面側で判定
        if (ym(new Date(s.due_date)) < MONTHS[5].t) return 'unpaid';
        return 'pending';
      });
    }

    ok(res, {
      DATA, HIST,
      MONTHS: MONTHS.map((m) => ({ y: m.y, m: m.m })),
      PROMISES: promises.map((p) => ({
        id: p.contract_id,
        day: md(new Date(p.promised_on)),
        heard: md(new Date(p.heard_on)),
        amount: p.amount, memo: p.memo || '',
      })),
      EVENTS: events.map((e) => ({
        cid: e.contract_id, no: e.no,
        when: new Date(e.occurred_at).toISOString().slice(0, 16).replace('T', ' '),
        who: e.recorded_by, kind: e.kind, text: e.text, memo: e.memo || '',
      })),
      実績未登録: contracts.length > 0 && schedules.every((s) => s.state !== '入金済み'),
    });
  } catch (e) {
    fail(res, e, 'contracts');
  }
};
