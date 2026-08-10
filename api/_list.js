// 顧客一覧の組み立て。
//
// 同じ一覧を /api/customers と /api/session の両方から返す。
// 画面を開いた直後は「ログインしているか」と「顧客一覧」を続けて聞いていたが、
// サーバーは遠く、しかもしばらく使われないと眠るため、
// 1回目の往復に待ち時間がかかる。それが2回続くと、開いた直後がまるまる遅い。
// 一覧をログイン確認の返事に同梱すれば、往復は1回で済む。
import { isoOf, today, summarize } from './_lib.js';
import { 索引, あいうえお順 } from './_yomi_dict.js';

// 絞り込みは '未入金' か '終了'。指定が無ければ全員。
export async function 顧客一覧(sql, 絞り込み) {
  // 3つは互いに関係がないので、同時に投げる。
  // データベースは遠くにあり、1回ごとに往復の待ち時間がかかる。
  // 順に待つと、その待ち時間が3つぶん足し算になる。
  //
  // is_test は c.* にも入るが、わざと名指しで書いている。
  // 列がまだ無いデータベースでは、ここで符号 42703 になって
  // _db.js が一度だけテーブルを作り直してくれる（画面から何も押さずに追いつく）。
  const [customers, schedules, paidRows, promises] = await Promise.all([
    sql(`SELECT c.*, c.is_test, c.status, a.name AS assignor_name, b.name AS assignee_name
           FROM customer c
           LEFT JOIN company a ON a.id = c.assignor_id
           LEFT JOIN company b ON b.id = c.assignee_id
          WHERE c.archived = false
          ORDER BY c.id`),
    sql(`SELECT id, customer_id, no, kind, due_date, planned_amount, state,
                dunned_count,
                to_char(dunned_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS dunned_on
           FROM schedule ORDER BY customer_id, due_date, kind, no`),
    sql(`SELECT schedule_id, COALESCE(sum(amount),0)::int AS n FROM allocation
          WHERE schedule_id IS NOT NULL GROUP BY schedule_id`),
    // まだ果たされていない入金約束。未入金の行に「いつ払うと言ったか」を出す
    sql(`SELECT customer_id, schedule_no, promised_on, until_time, amount
           FROM promise WHERE done = false ORDER BY promised_on, id`),
  ]);
  const paidBy = {};
  paidRows.forEach((r) => (paidBy[r.schedule_id] = r.n));

  const by = {};
  schedules.forEach((s) => (by[s.customer_id] = by[s.customer_id] || []).push(s));

  // 顧客ごとの、まだ果たされていない約束（日の近い順）。
  // どの回ぶんかでは絞らない。電話をかける人が知りたいのは
  // 「この人はいつ払うと言ったか」であって、何回目ぶんかではない
  const 約束ごと = {};
  promises.forEach((p) => (約束ごと[p.customer_id] = 約束ごと[p.customer_id] || []).push(p));

  let list = customers.map((c) => {
    const 予定 = by[c.id] || [];
    const s = summarize(c, 予定, paidBy);
    // いま追いかけている回。督促と約束はこの回のものを出す
    const 今の回 = 予定.filter((x) => x.state !== '入金済み')
      .sort((a, b) => String(isoOf(a.due_date)).localeCompare(String(isoOf(b.due_date))))[0] || null;
    const 候補 = 約束ごと[c.id] || [];
    const 約束 = 候補[0] || null;
    return {
      id: c.id, 氏名: c.name, よみ: c.kana || '',
      索引: 索引(c.name, c.kana), テスト: !!c.is_test,
      状態: c.status || '通常', 状態日: isoOf(c.status_date),
      引き落とし: c.debit_state || '未申込', 引き落とし日: isoOf(c.debit_date),
      // 終わった取引（引き上げ・完済）。督促の対象から外し、完済/引き上げタブに出す。
      // DB の内部の値は今も '回収'(status)のまま。画面に出す呼び名だけ「引き上げ」にしている
      終了: (c.status === '回収') || s.完済,
      終了理由: c.status === '回収' ? '引き上げ' : (s.完済 ? '完済' : ''),
      債権譲渡会社: c.assignor_name || '', 債権譲渡先: c.assignee_name || '',
      車種: c.car || '', 毎月の支払日: c.pay_day, 金額: c.monthly_amount,
      残り支払い回数: s.残り回数, 残債金額: s.残債,
      支払い回数: s.支払い回数, 支払い期日: s.次の期日, 回次: s.回次,
      この回の残り: s.この回の残り, 遅れ: s.遅れ, 遅れ日数: s.遅れ日数, 完済: s.完済,
      // ボーナス払い。未入金では名前の横に印を出す
      ボーナス回数: s.ボーナス回数, ボーナス残り: s.ボーナス残り,
      ボーナス総額: s.ボーナス総額, ボーナス中: s.ボーナス中, 回の種類: s.回の種類,
      電話番号: c.tel || '',
      // 督促。回ごとに持つので、次の回になれば「未督促」から始まる
      督促日: 今の回 ? (今の回.dunned_on || null) : null,
      督促回数: 今の回 ? (Number(今の回.dunned_count) || 0) : 0,
      // いつ払うと言ったか。約束の日を過ぎていれば 約束切れ
      約束: 約束 ? {
        日: isoOf(約束.promised_on),
        時刻: 約束.until_time ? String(約束.until_time).slice(0, 5) : null,
        金額: 約束.amount,
        件数: 候補.length,
        切れ: isoOf(約束.promised_on) < today(),
      } : null,
    };
  });

  if (絞り込み === '未入金') {
    // 期日を過ぎて、その回にまだ残りがある人。あいうえお順で出す。
    // 終わった取引（引き上げ・完済）は外す。引き上げた方に督促の電話はしない。
    //
    // 月額とボーナスは別の行にする。期日も金額も別なので、
    // 1行にまとめると「いま何の話をしているか」が電話で食い違う。
    // 両方とも遅れている人は、同じ名前が縦に2行並ぶ（月額の行 → ボーナスの行）。
    const t = today();
    const 出す = [];
    for (const r of list) {
      if (r.終了) continue;
      const 予定 = by[r.id] || [];
      for (const kind of ['通常', 'ボーナス']) {
        // その種類で、期日がいちばん早い未済の回
        const cur = 予定
          .filter((s) => (s.kind || '通常') === kind && s.state !== '入金済み')
          .sort((a, b) => String(isoOf(a.due_date)).localeCompare(String(isoOf(b.due_date))))[0];
        if (!cur) continue;
        const 期日 = isoOf(cur.due_date);
        if (期日 >= t) continue;                       // まだ期日が来ていない
        const 残り = Math.max(0, cur.planned_amount - (paidBy[cur.id] || 0));
        if (残り <= 0) continue;
        const 同種 = 予定.filter((s) => (s.kind || '通常') === kind);
        出す.push({
          ...r,
          種類: kind === 'ボーナス' ? 'ボーナス' : '月額',
          回次: cur.no, 回の種類: kind,
          支払い期日: 期日,
          金額: cur.planned_amount,          // その回の請求（月額かボーナス金額）
          この回の残り: 残り,
          遅れ: true,
          遅れ日数: Math.round((new Date(t) - new Date(期日)) / 86400000),
          支払い回数: 同種.filter((s) => s.state === '入金済み').length,
          残り支払い回数: 同種.filter((s) => s.state !== '入金済み').length,
          // 督促は回ごとに持つので、月額とボーナスで別々に控えられる
          督促日: cur.dunned_on || null,
          督促回数: Number(cur.dunned_count) || 0,
          ボーナス中: kind === 'ボーナス',
        });
      }
    }
    // 同じ人の2行は、並べ替えても月額が先に来る（sort は順を崩さない）
    list = 出す;
  } else if (絞り込み === '終了') {
    list = list.filter((r) => r.終了);
  }
  list.sort((a, b) => あいうえお順(
    { kana: a.よみ, name: a.氏名, id: a.id },
    { kana: b.よみ, name: b.氏名, id: b.id }));

  return { 顧客: list, 本日: today() };
}
