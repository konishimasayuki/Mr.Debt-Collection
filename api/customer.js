// 顧客ページの中身と、その顧客への書き込み。
// GET   /api/customer?id=1        … カレンダー・支払いの記録・メモ・約束
// PATCH /api/customer             … {id, 名前 / よみ / 連絡先 / 会社 …} を更新
// POST  /api/customer             … {id, 種類:'約束'|'約束変更'|'約束削除', …}
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, query, isoOf, today, yen, norm, remakeBonus, dueOf,
         詰め直す, 入金種類, 充てる順 } from './_lib.js';

const bad = (res, msg, why) => {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(JSON.stringify(why ? { error: msg, 理由: why } : { error: msg }));
};
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
const jp = (d) => String(d).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1年$2月$3日');

// 支払いの記録の、その回の下に出るメモ。約束を入れたときなどに自動で足す。
// 回が決まっていない約束は、どの回に出すか決められないので足さない。
// 通常とボーナスで回次の番号がぶつかるので、どちらの回かも一緒に持つ。
// 約束は通常の回にしか付かないので、既定は '通常'。
// いまの充当が「記録した順に、古い回へ詰めた形」になっているか。
//
// 入金を消したり顧客を付け替えたりすると、その入金の充当だけが外れ、
// ほかの入金は前の回に残る。すると「1回目は未入金なのに3回目は入金済み」
// という並びになる。いまはどの操作のあとも詰め直しているが、
// その前に崩れた記録はそのまま残っているので、画面で直せるようにする。
function 並びが崩れているか(予定, 入金, 充当) {
  const 埋まり = new Map(予定.map((s) => [s.id, 0]));
  const 正 = [];
  // 記録した順（id順）。api/_lib.js の詰め直すと同じ数え方
  for (const p of [...入金].sort((a, b) => a.id - b.id)) {
    let 残 = p.amount;
    // 種類を決めていない入金は月額として扱う（api/_lib.js の詰め直すと同じ）
    const 絞る = 入金種類(p.alloc_kind) || '通常';
    const 順 = 充てる順(予定.filter((s) => 埋まり.get(s.id) < s.planned_amount), 絞る);
    for (const s of 順) {
      if (残 <= 0) break;
      const あき = s.planned_amount - 埋まり.get(s.id);
      if (あき <= 0) continue;
      const 入 = Math.min(残, あき);
      正.push(`${p.id}:${s.id}:${入}`);
      埋まり.set(s.id, 埋まり.get(s.id) + 入);
      残 -= 入;
    }
  }
  const 今 = 充当.map((a) => `${a.payment_id}:${a.schedule_id}:${a.amount}`).sort();
  return 今.join('|') !== 正.sort().join('|');
}

// 画面に出す入金種類の呼び名。台帳の中では '通常'、画面では「月額」
const 種類名 = (k) => (k === 'ボーナス' ? 'ボーナス' : k === '両方' ? '月額＋ボーナス' : '月額');

const 回メモを足す = (sql, id, no, text, who, auto = true, 約束id = null, kind = '通常') => (no
  ? sql(`INSERT INTO schedule_memo (customer_id, schedule_no, kind, text, auto,
                                    promise_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, Number(no), kind, text, auto, 約束id, who])
  : Promise.resolve());
// 回の呼び名。ボーナスの3回目は「賞与3回目」。番号だけだと通常の3回目と見分けが付かない
const 回の名 = (no, kind) => `${kind === 'ボーナス' ? '賞与' : ''}${no}回目`;

// 約束から出るメモの文面。作るときも直すときも、必ずここを通す。
// 別々に組み立てると、直したときに文面と約束が食い違う。
const 約束の文 = (day, 時刻, amount, memo) =>
  `${jp(day)}${時刻 ? ` ${時刻}まで` : '（終日）'} に ${yen(amount)}円 の入金約束`
  + (memo ? ` — ${memo}` : '');

// 約束を直したら、その写しのメモも書き換える。
// メモは約束の「今の姿」を映すもの。文だけ直しても約束は変わらないので、
// 画面ではこのメモを直接は編集させず、約束のほうを直してもらう。
async function 約束のメモを合わせる(sql, 顧客id, 約束id, no, text, who) {
  const 有 = await sql(
    'SELECT id FROM schedule_memo WHERE promise_id=$1 AND customer_id=$2',
    [約束id, 顧客id]);
  if (有.length) {
    await sql(`UPDATE schedule_memo SET text=$1, schedule_no=$2, updated_at=now()
                WHERE id=$3`, [text, Number(no) || 有[0].schedule_no, 有[0].id]);
    return;
  }
  // 回を決めずに作った約束に、あとから回を付けたときはここへ来る
  await 回メモを足す(sql, 顧客id, no, text, who, true, 約束id);
}

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  const method = (req.method || 'GET').toUpperCase();

  try {
    const sql = db();

    // ── 読み取り ────────────────────────────
    if (method === 'GET') {
      const id = Number(query(req).id);
      if (!id) return bad(res, '顧客が指定されていません。');
      // 顧客ページは見るものが多い。互いに関係のない問い合わせなので同時に投げる。
      // データベースは遠くにあり、1回ごとに往復の待ち時間がかかるため、
      // 順に待つと、その待ち時間が7つぶん足し算になって画面が出るまで待たされる。
      // 充当も、この顧客のぶんだけに絞る（全件を集計しない）。
      const [[c], rows, paidRows, 充当明細, payments, promises, memos, events]
        = await Promise.all([
        sql(`SELECT c.*, a.name AS assignor_name, b.name AS assignee_name
               FROM customer c
               LEFT JOIN company a ON a.id = c.assignor_id
               LEFT JOIN company b ON b.id = c.assignee_id
              WHERE c.id=$1`, [id]),
        // 期日の順に並べる。ボーナスが通常の回のあいだに入るため
        sql(`SELECT id, no, kind, due_date, planned_amount, state FROM schedule
              WHERE customer_id=$1 ORDER BY due_date, kind, no`, [id]),
        sql(`SELECT a.schedule_id, COALESCE(sum(a.amount),0)::int AS n
               FROM allocation a
               JOIN schedule s ON s.id = a.schedule_id
              WHERE s.customer_id=$1
              GROUP BY a.schedule_id`, [id]),
        // その回に「いつ・いくら」入ったか。
        // 期日だけでは、遅れて払われたのか期日どおりだったのかが分からない。
        sql(`SELECT a.schedule_id, a.amount, a.payment_id, p.paid_on, p.method, p.source
               FROM allocation a
               JOIN schedule s ON s.id = a.schedule_id
               JOIN payment p  ON p.id = a.payment_id
              WHERE s.customer_id=$1
              ORDER BY p.paid_on, p.id`, [id]),
        sql(`SELECT p.id, p.paid_on, p.amount, p.method, p.source, p.ref_no, p.memo,
                    p.payer_name, p.recorded_by, p.created_at, p.alloc_kind
               FROM payment p WHERE p.customer_id=$1
              ORDER BY p.paid_on DESC, p.id DESC`, [id]),
        sql(`SELECT id, promised_on, until_time, schedule_no, amount, memo, done, created_by
               FROM promise WHERE customer_id=$1 ORDER BY promised_on, id`, [id]),
        // 約束の写しのメモは、その約束の日も一緒に返す。
        // 画面から約束そのものを直せるようにするため（メモの文だけ直しても約束は変わらない）
        // 書いた日と時刻は日本時間の文字どおりで返す。
        // UTCのまま切ると、夜に書いたメモが前日の日付で出る
        sql(`SELECT m.id, m.schedule_no, COALESCE(m.kind,'通常') AS kind,
                    m.text, m.auto, m.promise_id, m.created_by,
                    to_char(m.created_at AT TIME ZONE 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') AS at,
                    p.promised_on
               FROM schedule_memo m
               LEFT JOIN promise p ON p.id = m.promise_id
              WHERE m.customer_id=$1
              ORDER BY m.schedule_no, m.id DESC`, [id]),
        sql(`SELECT id, occurred_at, recorded_by, kind, text, memo
               FROM event WHERE customer_id=$1 ORDER BY id DESC LIMIT 200`, [id]),
      ]);
      if (!c) { res.statusCode = 404; return res.end(JSON.stringify({ error: '顧客が見つかりません。' })); }

      const paidBy = {};
      paidRows.forEach((r) => (paidBy[r.schedule_id] = r.n));

      // 回ごとの入金の明細（古い順）
      const 入金明細 = {};
      充当明細.forEach((r) => {
        (入金明細[r.schedule_id] = 入金明細[r.schedule_id] || []).push({
          日付: isoOf(r.paid_on), 金額: r.amount, 入金方法: r.method, 区分: r.source,
        });
      });

      // 回ごとのメモ。鍵は「種類 + 回次」。通常の3回目とボーナスの3回目を分ける
      const 回メモ = {};
      memos.forEach((m) => {
        const 鍵 = (m.kind || '通常') + m.schedule_no;
        (回メモ[鍵] = 回メモ[鍵] || []).push({
          id: m.id, 本文: m.text, 自動: m.auto, 記録者: m.created_by,
          約束id: m.promise_id || null, 約束日: isoOf(m.promised_on),
          日時: m.at,   // 「2026/08/07 09:12」（日本時間）
        });
      });

      // rows は期日の順。いちばん早い未済が「いま追いかけている回」
      const cur = rows.find((s) => s.state !== '入金済み') || null;
      const 入金合計 = rows.reduce((a, s) => a + (paidBy[s.id] || 0), 0);
      // 通常とボーナスは別に数える（画面では「全48回 + ボーナス4回」と出す）
      const 通常 = rows.filter((s) => (s.kind || '通常') === '通常');
      const ボ = rows.filter((s) => s.kind === 'ボーナス');

      return ok(res, {
        顧客: {
          id: c.id, 氏名: c.name, よみ: c.kana || '', テスト: !!c.is_test,
          状態: c.status || '通常', 状態日: isoOf(c.status_date),
          引き落とし: c.debit_state || '未申込', 引き落とし日: isoOf(c.debit_date),
          ボーナス月: c.bonus_months || [], ボーナス日: c.bonus_day || null,
          ボーナス金額: c.bonus_amount || null,
          性別: c.gender || '',
          生年月日: isoOf(c.birthday), 住所: c.address || '', 電話番号: c.tel || '',
          契約日: isoOf(c.contract_date), 車種: c.car || '',
          債権譲渡会社: c.assignor_name || '', 債権譲渡先: c.assignee_name || '',
          債権譲渡会社id: c.assignor_id, 債権譲渡先id: c.assignee_id,
          月々の金額: c.monthly_amount, 回数: c.term_count, 支払日: c.pay_day,
          開始日: isoOf(c.start_date), 支払総額: c.total_amount, メモ: c.memo || '',
          残債: Math.max(0, c.total_amount - 入金合計), 入金合計,
          残り回数: c.term_count - 通常.filter((s) => s.state === '入金済み').length,
          回次: cur ? cur.no : c.term_count,
          回の種類: cur ? (cur.kind || '通常') : '通常',
          ボーナス回数: ボ.length,
          ボーナス残り: ボ.filter((s) => s.state !== '入金済み').length,
          ボーナス総額: ボ.reduce((a, s) => a + s.planned_amount, 0),
          この回の請求: cur ? cur.planned_amount : 0,
          この回の入金: cur ? (paidBy[cur.id] || 0) : 0,
          この回の残り: cur ? Math.max(0, cur.planned_amount - (paidBy[cur.id] || 0)) : 0,
          次の期日: cur ? isoOf(cur.due_date) : null,
          完済: !cur,
          // 支払いの記録の並びが崩れているか。崩れているときだけ画面に入口を出す
          並びが崩れている: 並びが崩れているか(rows, payments, 充当明細),
        },
        支払予定: rows.map((s) => ({
          回次: s.no, 種類: s.kind || '通常',
          期日: isoOf(s.due_date), 請求: s.planned_amount,
          入金: paidBy[s.id] || 0, 状態: s.state,
          入金明細: 入金明細[s.id] || [],  // いつ・いくら入ったか（古い順）
          メモ: 回メモ[(s.kind || '通常') + s.no] || [],
        })),
        入金: payments.map((p) => ({
          id: p.id, 日付: isoOf(p.paid_on), 金額: p.amount, 入金方法: p.method,
          区分: p.source, 付番: p.ref_no || '', メモ: p.memo || '',
          振込人: p.payer_name || '', 記録者: p.recorded_by,
          // 月額かボーナスか。未入金タブの「割り当て直し」で選び直せる
          入金種類: 種類名(p.alloc_kind),
        })),
        約束: promises.map((p) => ({
          id: p.id, 日付: isoOf(p.promised_on), 時刻: hhmm(p.until_time),
          終日: !p.until_time, 回次: p.schedule_no, 金額: p.amount,
          メモ: p.memo || '', 済み: p.done, 記録者: p.created_by,
        })),
        記録: events.map((e) => ({
          id: e.id, 日時: new Date(e.occurred_at).toISOString().slice(0, 16).replace('T', ' '),
          記録者: e.recorded_by, 種類: e.kind, 内容: e.text, メモ: e.memo || '',
        })),
        本日: today(),
      });
    }

    const b = await readBody(req);
    const id = Number(b.id);
    if (!id) return bad(res, '顧客が指定されていません。');
    const c = (await sql('SELECT * FROM customer WHERE id=$1', [id]))[0];
    if (!c) return bad(res, '顧客が見つかりません。');
    const who = recordedBy(req);
    const memo = String(b.メモ || '').trim() || null;

    // ── 顧客の情報を直す ───────────────────────
    if (method === 'PATCH') {
      const set = [], val = [];
      const put = (col, v) => { val.push(v); set.push(`${col}=$${val.length}`); };
      if (b.名前 !== undefined) {
        const name = String(b.名前).trim();
        if (!name) return bad(res, 'お名前を入れてください。');
        put('name', name);
      }
      if (b.よみ !== undefined) put('kana', String(b.よみ).trim() || null);
      if (b.顧客メモ !== undefined) put('memo', String(b.顧客メモ));
      if (b.電話番号 !== undefined) put('tel', String(b.電話番号).trim() || null);
      if (b.住所 !== undefined) put('address', String(b.住所).trim() || null);
      if (b.車種 !== undefined) put('car', String(b.車種).trim() || null);
      if (b.性別 !== undefined) put('gender', String(b.性別).trim() || null);
      if (b.生年月日 !== undefined) put('birthday', b.生年月日 || null);
      if (b.契約日 !== undefined) put('contract_date', b.契約日 || null);

      // 取引の状態（通常 / 回収）。回収にすると督促の対象から外れる。
      // 値そのものは今も「回収」のまま持つ。画面での呼び名だけ「引き上げ」にしている
      const 状態一覧 = ['通常', '回収'];
      if (b.状態 !== undefined) {
        if (!状態一覧.includes(b.状態)) {
          return bad(res, '取引の状態が正しくありません。', 状態一覧.join(' / '));
        }
        put('status', b.状態);
        put('status_date', b.状態 === '回収' ? (b.状態日 || today()) : null);
      }

      // 口座振替（自動引き落とし）の手続き。日がいるのは申込と開始だけ
      const 振替一覧 = ['未申込', '口座振替申込', '口座振替開始', '口座振替停止'];
      if (b.引き落とし !== undefined) {
        if (!振替一覧.includes(b.引き落とし)) {
          return bad(res, '口座振替の状態が正しくありません。', 振替一覧.join(' / '));
        }
        const 日が要る = b.引き落とし === '口座振替申込' || b.引き落とし === '口座振替開始';
        put('debit_state', b.引き落とし);
        put('debit_date', 日が要る ? (b.引き落とし日 || today()) : null);
      }

      // 支払いの始まり（開始月・毎月の支払日）。
      //
      // 期日を動かすだけで、回の番号も金額も入金の行き先も動かさない。
      // 予定を作り直すと充当が消え、どの回に入ったお金か分からなくなる。
      // 「1回目の期日が3月6日ではなく6月6日だった」という登録の間違いを、
      // 入金を入れ直さずに直せるようにするため。
      let 期日結果 = null;
      if (b.開始月 !== undefined || b.支払日 !== undefined) {
        const 開始 = b.開始月 !== undefined
          ? String(b.開始月).trim() : isoOf(c.start_date).slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(開始)) {
          return bad(res, '支払い開始月は 2026-06 の形で入れてください。');
        }
        const [y0, m0] = 開始.split('-').map(Number);
        if (m0 < 1 || m0 > 12) return bad(res, '支払い開始月の月が正しくありません。');
        const 日 = b.支払日 !== undefined ? (Number(b.支払日) || 0) : c.pay_day;
        if (!日 || 日 < 1 || 日 > 31) {
          return bad(res, '毎月の支払日を1〜31で入れてください。');
        }
        const 前の開始 = isoOf(c.start_date).slice(0, 7);
        const 前の日 = c.pay_day;

        if (開始 !== 前の開始 || 日 !== 前の日) {
          // 通常の回の期日を、まとめて1回で書き換える
          const no = [], due = [];
          for (let k = 1; k <= c.term_count; k++) {
            no.push(k); due.push(dueOf(y0, m0, 日, k));
          }
          await sql(
            `UPDATE schedule s SET due_date = u.d::date
               FROM unnest($2::int[], $3::text[]) AS u(n, d)
              WHERE s.customer_id=$1 AND s.kind='通常' AND s.no = u.n`, [id, no, due]);
          // ボーナスの回も契約の期間に合わせて置き直す。
          // 入金が充てられている回は触らない（remakeBonus のきまり）
          if (c.bonus_months && c.bonus_months.length && c.bonus_amount) {
            await remakeBonus(sql, id, y0, m0, 日, c.term_count,
              c.bonus_months, c.bonus_day, c.bonus_amount);
          }
          await 詰め直す(sql, id);
          put('start_date', dueOf(y0, m0, 日, 1));
          if (日 !== 前の日) put('pay_day', 日);
          期日結果 = { 前: `${前の開始}（毎月${前の日}日）`, 後: `${開始}（毎月${日}日）` };
        }
      }

      // ボーナス払い。月は複数、日と金額は共通。
      // 予定を作り直すが、**入金が充てられている回は触らない**（remakeBonus）。
      let ボ結果 = null;
      if (b.ボーナス月 !== undefined || b.ボーナス日 !== undefined
          || b.ボーナス金額 !== undefined) {
        const 月 = b.ボーナス月 !== undefined
          ? [...new Set((b.ボーナス月 || []).map(Number).filter((m) => m >= 1 && m <= 12))]
            .sort((x, y) => x - y)
          : (c.bonus_months || []);
        const 日 = b.ボーナス日 !== undefined
          ? (Number(b.ボーナス日) || null) : c.bonus_day;
        const 額 = b.ボーナス金額 !== undefined
          ? (Math.round(Number(b.ボーナス金額)) || null) : c.bonus_amount;

        if (月.length && (!日 || 日 < 1 || 日 > 31)) {
          return bad(res, 'ボーナスの支払日を1〜31で入れてください。');
        }
        if (月.length && (!額 || 額 <= 0)) {
          return bad(res, 'ボーナスの金額を入れてください。');
        }
        const 使う月 = 月.length ? 月 : null;
        put('bonus_months', 使う月);
        put('bonus_day', 使う月 ? 日 : null);
        put('bonus_amount', 使う月 ? 額 : null);

        // 開始月を同時に変えているなら、変えたあとの期日で作る
        const 始 = b.開始月 !== undefined
          ? String(b.開始月).trim() : isoOf(c.start_date).slice(0, 7);
        const [y0, m0] = 始.split('-').map(Number);
        const 支払日 = b.支払日 !== undefined ? (Number(b.支払日) || c.pay_day) : c.pay_day;
        ボ結果 = await remakeBonus(sql, id, y0, m0, 支払日, c.term_count,
          使う月, 日, 額);
        // ここでは詰め直さない。remakeBonus は「入金が充てられている回は
        // 消さない」という決めごとで動いている。先に詰め直すと、そのお金が
        // 新しく作った別のボーナスの回へ移り、消してよい回・残す回の
        // 判断とちぐはぐになる。
        // 支払総額はボーナスを含める。残債はここから引いて出すため
        const ボ合計 = (await sql(
          `SELECT COALESCE(sum(planned_amount),0)::int AS n FROM schedule
            WHERE customer_id=$1 AND kind='ボーナス'`, [id]))[0].n;
        put('total_amount', c.monthly_amount * c.term_count + ボ合計);
      }

      // 会社の指定があれば実在を確かめる
      for (const [key, col] of [['債権譲渡会社', 'assignor_id'], ['債権譲渡先', 'assignee_id']]) {
        if (b[key] === undefined) continue;
        if (b[key]) {
          const co = await sql('SELECT id FROM company WHERE id=$1', [Number(b[key])]);
          if (!co.length) return bad(res, `${key}が見つかりません。`, '設定で登録してください');
          put(col, Number(b[key]));
        } else put(col, null);
      }
      if (!set.length) return bad(res, '変更する項目がありません。');
      val.push(id);
      await sql(`UPDATE customer SET ${set.join(', ')}, updated_at=now() WHERE id=$${val.length}`, val);

      if (b.よみ !== undefined && String(b.よみ).trim()) {
        await sql(`INSERT INTO payer_alias (normalized_name, customer_id, created_by)
                   VALUES ($1,$2,$3) ON CONFLICT (normalized_name) DO NOTHING`,
          [norm(b.よみ), id, who]);
      }
      // 何を変えたかが分かるように残す。状態と口座振替は名指しで書く
      let 何を = b.顧客メモ !== undefined ? '顧客のメモを更新した' : '顧客の情報を変更した';
      if (b.状態 !== undefined) {
        何を = b.状態 === '回収'
          ? `車両を引き上げた扱いにした（${b.状態日 || today()}）。督促の対象から外れる`
          : '取引の状態を「通常」に戻した。督促の対象に戻る';
      } else if (期日結果) {
        何を = `支払いの始まりを ${期日結果.前} → ${期日結果.後} に直した。`
          + `全${c.term_count}回の期日をずらした（入金の行き先は動かしていない）`;
      } else if (ボ結果) {
        const 月 = (b.ボーナス月 || []).join('月・');
        何を = 月
          ? `ボーナス払いを設定した：${月}月の${b.ボーナス日}日に ${yen(b.ボーナス金額)}円`
            + `（全${ボ結果.全体}回）`
          : 'ボーナス払いをやめた';
      } else if (b.引き落とし !== undefined) {
        const 日 = b.引き落とし日 || today();
        何を = b.引き落とし === '未申込' ? '口座振替を「未申込」にした'
          : b.引き落とし === '口座振替停止' ? '口座振替を「停止」にした'
          : `口座振替を「${b.引き落とし}」にした（${日}）`;
      }
      await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                 VALUES ($1,$2,$3,$4,NULL)`,
        [id, who,
         b.状態 !== undefined || b.引き落とし !== undefined || ボ結果 ? '設定' : 'メモ',
         何を]);
      return ok(res, { done: true });
    }

    // ── 入金約束(カレンダーから)──────────────────
    if (method === 'POST') {
      const 時刻 = b.終日 ? null : (String(b.時刻 || '').match(/^\d{2}:\d{2}$/) ? b.時刻 : null);

      if (b.種類 === '約束') {
        const day = String(b.日付 || '');
        const amount = Math.round(Number(b.金額) || 0);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad(res, '約束の日付を入れてください。');
        if (!amount || amount <= 0) return bad(res, '約束の金額を入れてください。');
        const no = b.回次 ? Number(b.回次) : null;
        if (no) {
          const s = await sql('SELECT id FROM schedule WHERE customer_id=$1 AND no=$2', [id, no]);
          if (!s.length) return bad(res, 'その回が見つかりません。');
        }
        const ins = await sql(
          `INSERT INTO promise (customer_id, promised_on, until_time, schedule_no, amount, memo, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [id, day, 時刻, no, amount, memo, who]);
        await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                   VALUES ($1,$2,'約束',$3,$4)`,
          [id, who, `${day}${時刻 ? ` ${時刻}まで` : '（終日）'} に ${yen(amount)}円`
            + (no ? `（${no}回目ぶん）` : '') + ' の入金約束', memo]);
        await 回メモを足す(sql, id, no, 約束の文(day, 時刻, amount, memo),
          who, true, ins[0].id);
        return ok(res, { done: true, id: ins[0].id });
      }

      if (b.種類 === '約束変更') {
        const pid = Number(b.約束id);
        const day = String(b.日付 || '');
        const amount = Math.round(Number(b.金額) || 0);
        if (!pid) return bad(res, 'どの約束かを指定してください。');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad(res, '約束の日付を入れてください。');
        if (!amount || amount <= 0) return bad(res, '約束の金額を入れてください。');
        const pr = (await sql('SELECT * FROM promise WHERE id=$1 AND customer_id=$2', [pid, id]))[0];
        if (!pr) return bad(res, 'その約束が見つかりません。');
        const 前 = { 日: isoOf(pr.promised_on), 額: pr.amount };
        await sql(
          `UPDATE promise SET promised_on=$1, until_time=$2, schedule_no=$3, amount=$4, memo=$5
            WHERE id=$6`,
          [day, 時刻, b.回次 ? Number(b.回次) : pr.schedule_no, amount,
           memo !== null ? memo : pr.memo, pid]);
        const 変更 = [];
        if (前.日 !== day) 変更.push(`日を ${前.日} から ${day} へ`);
        if (前.額 !== amount) 変更.push(`金額を ${yen(前.額)}円 から ${yen(amount)}円 へ`);
        await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                   VALUES ($1,$2,'約束',$3,$4)`,
          [id, who, `約束を動かした（${変更.length ? 変更.join('、') : 'メモだけ更新'}）`, memo]);
        // 経緯は記録(event)に残す。回メモのほうは行を増やさず、今の姿に書き換える。
        // 増やすと、同じ約束の古い金額がいつまでも並び、どれが本当か分からなくなる。
        const 新回 = b.回次 ? Number(b.回次) : pr.schedule_no;
        await 約束のメモを合わせる(sql, id, pid, 新回,
          約束の文(day, 時刻, amount, memo !== null ? memo : pr.memo), who);
        return ok(res, { done: true, もとの日: 前.日, もとの金額: 前.額 });
      }

      if (b.種類 === '約束削除') {
        const pid = Number(b.約束id);
        const pr = (await sql('SELECT * FROM promise WHERE id=$1 AND customer_id=$2', [pid, id]))[0];
        if (!pr) return bad(res, 'その約束が見つかりません。');
        // 写しのメモを片づけて、「取り消し」の1行に置き換える。
        // 書き換えではなく入れ直すのは、取り消しがいま起きたことだから。
        // 書き換えると元の位置に留まり、古い約束のぶんは折りたたみに隠れて見えない。
        // 行数は増えない（1件消して1件足す）。
        const 取消文 = `${jp(isoOf(pr.promised_on))} の入金約束（${yen(pr.amount)}円）を取り消し`
          + (memo ? ` — ${memo}` : '');
        await sql('DELETE FROM schedule_memo WHERE promise_id=$1 AND customer_id=$2', [pid, id]);
        await 回メモを足す(sql, id, pr.schedule_no, 取消文, who);
        await sql('DELETE FROM promise WHERE id=$1', [pid]);
        // 約束そのものは消すが、消したことは記録に残す
        await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                   VALUES ($1,$2,'約束',$3,$4)`,
          [id, who, `${isoOf(pr.promised_on)} の約束（${yen(pr.amount)}円）を取り消した`, memo]);
        return ok(res, { done: true });
      }

      // ── 回ごとのメモ（支払いの記録の各回の下）────────
      // ボーナスの回にも足せる。通常の3回目とボーナスの3回目は別ものなので、
      // どちらの回かを一緒に持つ
      // ── 入金の種類（月額 / ボーナス）をまとめて直す ─────
      //
      // 未入金タブから、電話中にその場で直せるようにするための口。
      // 1件ずつ直すと、そのたびに顧客まるごと詰め直すことになる。
      // まとめて受けて、詰め直しは最後に一度だけにする。
      if (b.種類 === '割り当て直し') {
        const 変更 = Array.isArray(b.変更) ? b.変更 : [];
        if (!変更.length) return bad(res, '直すものがありません。');
        const ids = 変更.map((x) => Number(x.入金id)).filter(Boolean);
        if (ids.length !== 変更.length) return bad(res, 'どの入金かを指定してください。');

        const 今 = await sql(
          `SELECT id, amount, alloc_kind, to_char(paid_on,'YYYY-MM-DD') AS on
             FROM payment WHERE id = ANY($1::int[]) AND customer_id=$2`, [ids, id]);
        if (今.length !== ids.length) {
          return bad(res, 'その入金が見つかりません。', 'この顧客の入金だけを直せます');
        }
        const ボ = await sql(
          `SELECT 1 FROM schedule WHERE customer_id=$1 AND kind='ボーナス' LIMIT 1`, [id]);

        const 種類ごと = {}, 記す = [];
        for (const x of 変更) {
          const k = 入金種類(x.入金種類);
          if (!k) return bad(res, '入金種類が正しくありません。');
          if (k !== '通常' && !ボ.length) {
            return bad(res, 'この方にはボーナス払いの設定がありません。');
          }
          const p2 = 今.find((y) => y.id === Number(x.入金id));
          if ((p2.alloc_kind || '通常') === k) continue;   // 変わらないものは触らない
          (種類ごと[k] = 種類ごと[k] || []).push(p2.id);
          記す.push(`${p2.on} の ${yen(p2.amount)}円 を`
            + `${種類名(p2.alloc_kind)}→${種類名(k)}`);
        }
        if (!記す.length) return ok(res, { done: true, 変えた件数: 0 });

        // 種類ごとに1回ずつ書き換える。件数がいくつでも問い合わせは増えない
        await Promise.all(Object.entries(種類ごと).map(([k, 群]) =>
          sql('UPDATE payment SET alloc_kind=$1, updated_at=now() WHERE id = ANY($2::int[])',
            [k, 群])));
        await 詰め直す(sql, id);
        await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                   VALUES ($1,$2,'訂正',$3,$4)`,
          [id, who, `入金の割り当てを直した：${記す.join('、')}`,
           String(b.メモ || '').trim() || null]);
        return ok(res, { done: true, 変えた件数: 記す.length });
      }

      // ── 支払いの記録を詰め直す ─────────────────
      //
      // 「1回目は未入金なのに3回目は入金済み」という並びを直す。
      // 入金の金額も件数も残債も変わらない。どの回に充てるかだけを並べ直す。
      if (b.種類 === '詰め直す') {
        await 詰め直す(sql, id);
        await sql(`INSERT INTO event (customer_id, recorded_by, kind, text)
                   VALUES ($1,$2,'記録',$3)`,
          [id, who, '支払いの記録を詰め直した（古い回から順に充て直した）']);
        return ok(res, { done: true });
      }

      // ── 入金月の変更 ────────────────────────
      //
      // 「今月から払えないので、11月から仕切り直す」というときに使う。
      // 未払いの回から先だけを、まとめて後ろ（または前）へずらす。
      // すでに払い終えた回は動かさない。入金の行き先も動かさない。
      //
      // 顧客情報の「支払い開始月」は登録の間違いを直すもので、全部の回を
      // ずらす。こちらは払いの立て直しなので、未払いの回だけをずらす。
      if (b.種類 === '入金月変更') {
        const 新 = String(b.新しい月 || '').trim();
        if (!/^\d{4}-\d{2}$/.test(新)) {
          return bad(res, '新しい月は 2026-11 の形で選んでください。');
        }
        const メモ = String(b.メモ || '').trim();
        // メモを必ず書かせる。あとから「なぜ期日が動いたのか」が分からないと、
        // 電話口でお客様と話が食い違う
        if (!メモ) return bad(res, '変更の理由をメモに書いてください。');

        const 未払い = await sql(
          `SELECT id, no, kind, to_char(due_date,'YYYY-MM-DD') AS due
             FROM schedule
            WHERE customer_id=$1 AND state <> '入金済み'
            ORDER BY due_date, kind, no`, [id]);
        if (!未払い.length) return bad(res, '未払いの回がありません。');

        const 基準 = 未払い[0];
        const [by, bm] = 基準.due.split('-').map(Number);
        const [ny, nm] = 新.split('-').map(Number);
        if (nm < 1 || nm > 12) return bad(res, '月が正しくありません。');
        const ずれ = (ny * 12 + (nm - 1)) - (by * 12 + (bm - 1));
        if (!ずれ) return bad(res, '同じ月です。変わりません。');

        // 未払いの回を、まとめて同じ月数だけずらす。日はそのまま
        // （その月に無い日は末日にする）
        const ids = [], dues = [];
        未払い.forEach((s2) => {
          const [y, m, dd] = s2.due.split('-').map(Number);
          const t = y * 12 + (m - 1) + ずれ;
          const y2 = Math.floor(t / 12), m2 = (t % 12) + 1;
          ids.push(s2.id);
          dues.push(`${y2}-${String(m2).padStart(2, '0')}-`
            + String(Math.min(dd, new Date(y2, m2, 0).getDate())).padStart(2, '0'));
        });
        await sql(
          `UPDATE schedule s SET due_date = u.d::date
             FROM unnest($1::int[], $2::text[]) AS u(i, d)
            WHERE s.id = u.i`, [ids, dues]);

        // 期日が動くと、古い順の並びが変わる。まるごと詰め直して、
        // 「1回目は未入金なのに3回目は入金済み」という並びを作らない
        await 詰め直す(sql, id);

        const 前 = 基準.due, 後 = dues[0];
        const 向き = ずれ > 0 ? `${ずれ}か月あと` : `${-ずれ}か月まえ`;
        const 文 = `支払日を ${前} → ${後} に変更（${向き}）。${メモ}`;
        // 支払いの記録にも出す。基準にした回に1行残す
        await 回メモを足す(sql, id, 基準.no, 文, who, true, null, 基準.kind || '通常');
        await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                   VALUES ($1,$2,'記録',$3,$4)`,
          [id, who,
           `入金月を変更した：${前} → ${後}（${向き}）。未払いの${未払い.length}回をずらした`,
           メモ]);
        return ok(res, { done: true, 前, 後, ずれ, 件数: 未払い.length });
      }

      if (b.種類 === '回メモ') {
        const no = Number(b.回次);
        const kind = b.回の種類 === 'ボーナス' ? 'ボーナス' : '通常';
        const text = String(b.本文 || '').trim();
        if (!no) return bad(res, 'どの回かを指定してください。');
        if (!text) return bad(res, 'メモを入れてください。');
        const s2 = await sql(
          `SELECT id FROM schedule
            WHERE customer_id=$1 AND no=$2 AND COALESCE(kind,'通常')=$3`, [id, no, kind]);
        if (!s2.length) return bad(res, 'その回が見つかりません。');
        const r = await sql(
          `INSERT INTO schedule_memo (customer_id, schedule_no, kind, text, auto, created_by)
           VALUES ($1,$2,$3,$4,false,$5) RETURNING id`, [id, no, kind, text, who]);
        return ok(res, { done: true, id: r[0].id });
      }

      if (b.種類 === '回メモ変更') {
        const mid = Number(b.メモid);
        const text = String(b.本文 || '').trim();
        if (!mid) return bad(res, 'どのメモかを指定してください。');
        if (!text) return bad(res, 'メモを入れてください。');
        const m = (await sql(
          'SELECT id FROM schedule_memo WHERE id=$1 AND customer_id=$2', [mid, id]))[0];
        if (!m) return bad(res, 'そのメモが見つかりません。');
        await sql('UPDATE schedule_memo SET text=$1, updated_at=now() WHERE id=$2', [text, mid]);
        return ok(res, { done: true });
      }

      if (b.種類 === '回メモ削除') {
        const mid = Number(b.メモid);
        const m = (await sql(
          'SELECT * FROM schedule_memo WHERE id=$1 AND customer_id=$2', [mid, id]))[0];
        if (!m) return bad(res, 'そのメモが見つかりません。');
        await sql('DELETE FROM schedule_memo WHERE id=$1', [mid]);
        // メモは消せるが、消したことは記録に残す
        await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                   VALUES ($1,$2,'メモ',$3,$4)`,
          [id, who, `${回の名(m.schedule_no, m.kind)}のメモを消した`, m.text]);
        return ok(res, { done: true });
      }

      // ── 督促の連絡 ─────────────────────────
      // 「もう電話したか」を回ごとに控える。
      // 顧客ごとに持つと、次の月になっても督促済みのままになり、
      // かけ忘れた人が分からなくなる。回が変われば、また未督促から始まる。
      if (b.種類 === '督促' || b.種類 === '督促取消') {
        const no = Number(b.回次) || 0;
        const kind = b.回の種類 === 'ボーナス' ? 'ボーナス' : '通常';
        if (!no) return bad(res, 'どの回かを指定してください。');
        const s = (await sql(
          `SELECT id, dunned_count, dunned_undone_at,
                  to_char(dunned_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS dunned_on
             FROM schedule WHERE customer_id=$1 AND kind=$2 AND no=$3`,
          [id, kind, no]))[0];
        if (!s) return bad(res, 'その回が見つかりません。');
        const 前の回数 = Number(s.dunned_count) || 0;
        const 取消中 = !!s.dunned_undone_at;

        // 取り消しても日付と回数は消さない。押し間違いを元へ戻せるようにするため。
        // 「取り消してある」という印（dunned_undone_at）だけを立てる
        if (b.種類 === '督促取消') {
          await sql('UPDATE schedule SET dunned_undone_at=now() WHERE id=$1', [s.id]);
          await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                     VALUES ($1,$2,'督促',$3,$4)`,
            [id, who, `${no}回目の督促の記録を取り消した`
              + (前の回数 ? `（${s.dunned_on} の ${前の回数}回目ぶん）` : ''), memo]);
          return ok(res, { done: true, 督促回数: 0 });
        }

        // 押し間違いを元へ戻す。日付も回数も、取り消す前のまま
        if (b.元に戻す) {
          if (!取消中 || !前の回数) return bad(res, '元に戻す督促の記録がありません。');
          await sql('UPDATE schedule SET dunned_undone_at=NULL WHERE id=$1', [s.id]);
          await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                     VALUES ($1,$2,'督促',$3,$4)`,
            [id, who, `${no}回目の督促の記録を元に戻した（${s.dunned_on} の ${前の回数}回目ぶん）`,
             memo]);
          return ok(res, { done: true, 督促回数: 前の回数 });
        }

        // 取り消してあったなら、そこまでの回数は数えない。今日から1回目として数え直す
        const n = 取消中 ? 1 : 前の回数 + 1;
        await sql(`UPDATE schedule SET dunned_at=now(), dunned_count=$1, dunned_by=$2,
                          dunned_undone_at=NULL
                    WHERE id=$3`, [n, who, s.id]);
        await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                   VALUES ($1,$2,'督促',$3,$4)`,
          [id, who, `${no}回目ぶんの督促を連絡した（${n}回目）`, memo]);
        return ok(res, { done: true, 督促回数: n });
      }

      return bad(res, '種類が指定されていません。');
    }

    return bad(res, '対応していない操作です。');
  } catch (e) {
    fail(res, e, 'customer');
  }
};
