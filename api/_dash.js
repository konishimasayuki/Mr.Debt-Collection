// ダッシュボードの組み立て。いま何が回収できていないかを、月ごとに積み上げる。
//
// 同じ組み立てを /api/dashboard と /api/session の両方から返す。
// ダッシュボードは開いた直後にまず出すタブなので、顧客一覧と同じ理由で
// ログイン確認の返事に同梱できるようにしてある(api/session.js)。
//
// 見せ方の決めごと
// ・**期日が今日以前の回だけ**を数える。まだ期日の来ていない回は「未回収」ではない
// ・**100%回収できた月は出さない。**残っている月は、どれだけ古くても出し続ける
// ・車を引き上げた方と、動作を試すための顧客は外す。経営者が見る数字なので混ぜない
import { isoOf, today } from './_lib.js';

// 「2026-06」→「2026年6月分」
const 月の見出し = (ym) => {
  const [y, m] = ym.split('-');
  return `${Number(y)}年${Number(m)}月分`;
};

export async function ダッシュボード(sql) {
  const t = today();

  // 4つは互いに関係がないので同時に投げる。
  // 順に待つと、遠くのデータベースへの往復が4つぶん足し算になる。
  const [顧客, 予定, 充当, 約束] = await Promise.all([
    // 車を引き上げた方は督促しない。試すための顧客は数字に混ぜない
    sql(`SELECT id, name, kana, monthly_amount, is_test, status
           FROM customer
          WHERE archived = false AND status <> '回収' AND is_test = false`),
    sql(`SELECT id, customer_id, no, kind, due_date, planned_amount, state,
                dunned_count,
                to_char(dunned_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS dunned_on
           FROM schedule WHERE due_date <= $1 ORDER BY due_date, customer_id, kind, no`, [t]),
    sql(`SELECT schedule_id, COALESCE(sum(amount),0)::int AS n FROM allocation
          WHERE schedule_id IS NOT NULL GROUP BY schedule_id`),
    // まだ果たされていない約束だけ。果たした約束は後回しではない
    sql(`SELECT id, customer_id, schedule_no, promised_on, until_time, amount
           FROM promise WHERE done = false ORDER BY promised_on, id`),
  ]);

  const 顧客ごと = {};
  顧客.forEach((c) => (顧客ごと[c.id] = c));
  const 入金額 = {};
  充当.forEach((a) => (入金額[a.schedule_id] = a.n));

  // ── 月ごとにまとめる ──────────────────────
  const 月ごと = new Map();   // '2026-06' → {全件, 回収済み, 未回収額, 行:[…]}
  for (const s of 予定) {
    const c = 顧客ごと[s.customer_id];
    if (!c) continue;                       // 引き上げ済み・テスト顧客
    const ym = String(isoOf(s.due_date)).slice(0, 7);
    if (!月ごと.has(ym)) 月ごと.set(ym, { 全件: 0, 回収済み: 0, 未回収額: 0, 行: [] });
    const m = 月ごと.get(ym);
    m.全件++;
    if (s.state === '入金済み') { m.回収済み++; continue; }
    const 入った = 入金額[s.id] || 0;
    const 残り = Math.max(0, s.planned_amount - 入った);
    m.未回収額 += 残り;
    m.行.push({
      顧客id: c.id, 氏名: c.name, よみ: c.kana || '',
      回次: s.no, 回の種類: s.kind || '通常',
      期日: isoOf(s.due_date),
      料金: s.planned_amount, 入金済み: 入った, 残り,
      督促回数: Number(s.dunned_count) || 0,
      督促日: s.dunned_on || null,
      // 約束はこのあとで付ける
      後回し: null,
    });
  }

  // ── 後回しの約束を、行に付ける ──────────────────
  // 回次の入っている約束は、その回の月へ。
  // 回次の無い約束は、その顧客のいちばん古い未回収の月へ付ける
  // （どの回のことか分からないので、いちばん困っている回に付ける）。
  const 行を引く = {};                       // '顧客id:回次' → 行
  const いちばん古い行 = {};                  // 顧客id → 行
  const 並び = [...月ごと.keys()].sort();
  for (const ym of 並び) {
    for (const r of 月ごと.get(ym).行) {
      if (r.回の種類 === '通常') 行を引く[`${r.顧客id}:${r.回次}`] = r;
      if (!いちばん古い行[r.顧客id]) いちばん古い行[r.顧客id] = r;
    }
  }
  for (const p of 約束) {
    const 行 = (p.schedule_no != null && 行を引く[`${p.customer_id}:${p.schedule_no}`])
      || いちばん古い行[p.customer_id];
    if (!行) continue;                       // その回はもう入金済み
    if (!行.後回し) 行.後回し = { 件数: 0, 日: null, 時刻: null, 金額: 0, 切れ: false };
    行.後回し.件数++;
    // いちばん近い約束の中身を出す（並びは promised_on 順）
    if (行.後回し.件数 === 1) {
      行.後回し.日 = isoOf(p.promised_on);
      行.後回し.時刻 = p.until_time ? String(p.until_time).slice(0, 5) : null;
      行.後回し.金額 = p.amount;
      // 約束の日を過ぎても入っていない。いちばん先に電話する相手
      行.後回し.切れ = isoOf(p.promised_on) < t;
    }
  }

  // ── 2つ以上の月に出ている顧客に印を付ける ──────────
  // 先月も今月も入っていない人は、いちばん先に電話する相手
  const 何か月 = {};
  for (const ym of 並び) {
    const 見た = new Set();
    for (const r of 月ごと.get(ym).行) {
      if (見た.has(r.顧客id)) continue;      // 同じ月にボーナスと通常が並ぶことがある
      見た.add(r.顧客id);
      何か月[r.顧客id] = (何か月[r.顧客id] || 0) + 1;
    }
  }

  // ── 出す形にする ────────────────────────
  // 100%回収できた月は出さない。残っている月は古い順に積み上げる
  const 月 = [];
  for (const ym of 並び) {
    const m = 月ごと.get(ym);
    if (!m.行.length) continue;
    m.行.forEach((r) => {
      r.重複 = (何か月[r.顧客id] || 0) > 1;
      r.重なった月数 = 何か月[r.顧客id] || 1;
    });
    // 名前順ではなく、金額の大きい順。先に電話すべき相手が上に来る
    m.行.sort((a, b) => b.残り - a.残り || a.氏名.localeCompare(b.氏名, 'ja'));
    月.push({
      年月: ym, 見出し: 月の見出し(ym),
      全件: m.全件, 回収済み: m.回収済み,
      率: m.全件 ? Math.round((m.回収済み / m.全件) * 100) : 100,
      未回収額: m.未回収額,
      後回し数: m.行.filter((r) => r.後回し).length,
      行: m.行,
    });
  }

  // ── 約束の日を過ぎても入っていない人 ──────────────
  // 「今日までに払う」と言った日を過ぎている。いちばん先に電話する相手
  const 約束切れ = [];
  for (const m of 月) {
    for (const r of m.行) {
      if (r.後回し && r.後回し.切れ) {
        約束切れ.push({
          顧客id: r.顧客id, 氏名: r.氏名, 見出し: m.見出し,
          約束日: r.後回し.日, 約束金額: r.後回し.金額, 件数: r.後回し.件数,
          残り: r.残り,
          過ぎた日数: Math.round((new Date(t) - new Date(r.後回し.日)) / 86400000),
          督促回数: r.督促回数, 督促日: r.督促日,
        });
      }
    }
  }
  約束切れ.sort((a, b) => b.過ぎた日数 - a.過ぎた日数);

  // 全体の回収率。月をまたいだ合計
  const 全件 = 月.reduce((a, x) => a + x.全件, 0);
  const 済 = 月.reduce((a, x) => a + x.回収済み, 0);

  return {
    本日: t,
    合計: {
      全件, 回収済み: 済,
      率: 全件 ? Math.round((済 / 全件) * 100) : 100,
      未回収額: 月.reduce((a, x) => a + x.未回収額, 0),
      未回収人数: new Set(月.flatMap((x) => x.行.map((r) => r.顧客id))).size,
    },
    月,
    // 入金約束の日を過ぎても入っていない人。ここがいちばん急ぐ
    約束切れ,
  };
}
