// 顧客一覧の組み立て。
//
// 同じ一覧を /api/customers と /api/session の両方から返す。
// 画面を開いた直後は「ログインしているか」と「顧客一覧」を続けて聞いていたが、
// サーバーは遠く、しかもしばらく使われないと眠るため、
// 1回目の往復に待ち時間がかかる。それが2回続くと、開いた直後がまるまる遅い。
// 一覧をログイン確認の返事に同梱すれば、往復は1回で済む。
import { isoOf, today, norm, summarize } from './_lib.js';
import { 並び読み, 索引 } from './_yomi_dict.js';

// あいうえお順。登録された「よみ」が無い人は苗字の辞書で補って並べる。
// それでも読みが分からない人だけ、最後にまわす。
const collator = new Intl.Collator('ja');
const byKana = (a, b) => {
  const ak = norm(並び読み(a.name, a.kana)), bk = norm(並び読み(b.name, b.kana));
  if (!!ak !== !!bk) return ak ? -1 : 1;
  return collator.compare(ak || a.name, bk || b.name) || a.id - b.id;
};

// 絞り込みは '未入金' か '終了'。指定が無ければ全員。
export async function 顧客一覧(sql, 絞り込み) {
  // 3つは互いに関係がないので、同時に投げる。
  // データベースは遠くにあり、1回ごとに往復の待ち時間がかかる。
  // 順に待つと、その待ち時間が3つぶん足し算になる。
  //
  // is_test は c.* にも入るが、わざと名指しで書いている。
  // 列がまだ無いデータベースでは、ここで符号 42703 になって
  // _db.js が一度だけテーブルを作り直してくれる（画面から何も押さずに追いつく）。
  const [customers, schedules, paidRows] = await Promise.all([
    sql(`SELECT c.*, c.is_test, c.status, a.name AS assignor_name, b.name AS assignee_name
           FROM customer c
           LEFT JOIN company a ON a.id = c.assignor_id
           LEFT JOIN company b ON b.id = c.assignee_id
          WHERE c.archived = false
          ORDER BY c.id`),
    sql(`SELECT id, customer_id, no, kind, due_date, planned_amount, state
           FROM schedule ORDER BY customer_id, due_date, kind, no`),
    sql(`SELECT schedule_id, COALESCE(sum(amount),0)::int AS n FROM allocation
          WHERE schedule_id IS NOT NULL GROUP BY schedule_id`),
  ]);
  const paidBy = {};
  paidRows.forEach((r) => (paidBy[r.schedule_id] = r.n));

  const by = {};
  schedules.forEach((s) => (by[s.customer_id] = by[s.customer_id] || []).push(s));

  let list = customers.map((c) => {
    const s = summarize(c, by[c.id] || [], paidBy);
    return {
      id: c.id, 氏名: c.name, よみ: c.kana || '',
      索引: 索引(c.name, c.kana), テスト: !!c.is_test,
      状態: c.status || '通常', 状態日: isoOf(c.status_date),
      引き落とし: c.debit_state || '未申込', 引き落とし日: isoOf(c.debit_date),
      // 終わった取引（回収・完済）。督促の対象から外し、終了タブに出す
      終了: (c.status === '回収') || s.完済,
      終了理由: c.status === '回収' ? '回収' : (s.完済 ? '完済' : ''),
      債権譲渡会社: c.assignor_name || '', 債権譲渡先: c.assignee_name || '',
      車種: c.car || '', 毎月の支払日: c.pay_day, 金額: c.monthly_amount,
      残り支払い回数: s.残り回数, 残債金額: s.残債,
      支払い回数: s.支払い回数, 支払い期日: s.次の期日, 回次: s.回次,
      この回の残り: s.この回の残り, 遅れ: s.遅れ, 遅れ日数: s.遅れ日数, 完済: s.完済,
      // ボーナス払い。未入金では名前の横に印を出す
      ボーナス回数: s.ボーナス回数, ボーナス残り: s.ボーナス残り,
      ボーナス総額: s.ボーナス総額, ボーナス中: s.ボーナス中, 回の種類: s.回の種類,
      電話番号: c.tel || '',
    };
  });

  if (絞り込み === '未入金') {
    // 期日を過ぎて、その回にまだ残りがある人。あいうえお順で出す。
    // 終わった取引（回収・完済）は外す。回収した方に督促の電話はしない。
    list = list.filter((r) => !r.終了 && r.遅れ && r.この回の残り > 0);
  } else if (絞り込み === '終了') {
    list = list.filter((r) => r.終了);
  }
  list.sort((a, b) => byKana(
    { kana: a.よみ, name: a.氏名, id: a.id },
    { kana: b.よみ, name: b.氏名, id: b.id }));

  return { 顧客: list, 本日: today() };
}
