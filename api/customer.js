// 顧客ページの中身と、その顧客への書き込み。
// GET   /api/customer?id=1        … カレンダー・支払いの記録・メモ・約束
// PATCH /api/customer             … {id, 名前 / よみ / 連絡先 / 会社 …} を更新
// POST  /api/customer             … {id, 種類:'約束'|'約束変更'|'約束削除', …}
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, query, isoOf, today, yen, norm } from './_lib.js';

const bad = (res, msg, why) => {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(JSON.stringify(why ? { error: msg, 理由: why } : { error: msg }));
};
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
const jp = (d) => String(d).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1年$2月$3日');

// 支払いの記録の、その回の下に出るメモ。約束を入れたときなどに自動で足す。
// 回が決まっていない約束は、どの回に出すか決められないので足さない。
const 回メモを足す = (sql, id, no, text, who, auto = true) => (no
  ? sql(`INSERT INTO schedule_memo (customer_id, schedule_no, text, auto, created_by)
         VALUES ($1,$2,$3,$4,$5)`, [id, Number(no), text, auto, who])
  : Promise.resolve());

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
      const [[c], rows, paidRows, payments, promises, memos, events] = await Promise.all([
        sql(`SELECT c.*, a.name AS assignor_name, b.name AS assignee_name
               FROM customer c
               LEFT JOIN company a ON a.id = c.assignor_id
               LEFT JOIN company b ON b.id = c.assignee_id
              WHERE c.id=$1`, [id]),
        sql(`SELECT id, no, due_date, planned_amount, state FROM schedule
              WHERE customer_id=$1 ORDER BY no`, [id]),
        sql(`SELECT a.schedule_id, COALESCE(sum(a.amount),0)::int AS n
               FROM allocation a
               JOIN schedule s ON s.id = a.schedule_id
              WHERE s.customer_id=$1
              GROUP BY a.schedule_id`, [id]),
        sql(`SELECT p.id, p.paid_on, p.amount, p.method, p.source, p.ref_no, p.memo,
                    p.payer_name, p.recorded_by, p.created_at
               FROM payment p WHERE p.customer_id=$1
              ORDER BY p.paid_on DESC, p.id DESC`, [id]),
        sql(`SELECT id, promised_on, until_time, schedule_no, amount, memo, done, created_by
               FROM promise WHERE customer_id=$1 ORDER BY promised_on, id`, [id]),
        sql(`SELECT id, schedule_no, text, auto, created_by, created_at
               FROM schedule_memo WHERE customer_id=$1
              ORDER BY schedule_no, id DESC`, [id]),
        sql(`SELECT id, occurred_at, recorded_by, kind, text, memo
               FROM event WHERE customer_id=$1 ORDER BY id DESC LIMIT 200`, [id]),
      ]);
      if (!c) { res.statusCode = 404; return res.end(JSON.stringify({ error: '顧客が見つかりません。' })); }

      const paidBy = {};
      paidRows.forEach((r) => (paidBy[r.schedule_id] = r.n));

      const 回メモ = {};
      memos.forEach((m) => {
        (回メモ[m.schedule_no] = 回メモ[m.schedule_no] || []).push({
          id: m.id, 本文: m.text, 自動: m.auto, 記録者: m.created_by,
          日時: new Date(m.created_at).toISOString().slice(0, 16).replace('T', ' '),
        });
      });

      const cur = rows.find((s) => s.state !== '入金済み') || null;
      const 入金合計 = rows.reduce((a, s) => a + (paidBy[s.id] || 0), 0);

      return ok(res, {
        顧客: {
          id: c.id, 氏名: c.name, よみ: c.kana || '', テスト: !!c.is_test,
          性別: c.gender || '',
          生年月日: isoOf(c.birthday), 住所: c.address || '', 電話番号: c.tel || '',
          契約日: isoOf(c.contract_date), 車種: c.car || '',
          債権譲渡会社: c.assignor_name || '', 債権譲渡先: c.assignee_name || '',
          債権譲渡会社id: c.assignor_id, 債権譲渡先id: c.assignee_id,
          月々の金額: c.monthly_amount, 回数: c.term_count, 支払日: c.pay_day,
          開始日: isoOf(c.start_date), 支払総額: c.total_amount, メモ: c.memo || '',
          残債: Math.max(0, c.total_amount - 入金合計), 入金合計,
          残り回数: c.term_count - rows.filter((s) => s.state === '入金済み').length,
          回次: cur ? cur.no : c.term_count,
          この回の請求: cur ? cur.planned_amount : 0,
          この回の入金: cur ? (paidBy[cur.id] || 0) : 0,
          この回の残り: cur ? Math.max(0, cur.planned_amount - (paidBy[cur.id] || 0)) : 0,
          次の期日: cur ? isoOf(cur.due_date) : null,
          完済: !cur,
        },
        支払予定: rows.map((s) => ({
          回次: s.no, 期日: isoOf(s.due_date), 請求: s.planned_amount,
          入金: paidBy[s.id] || 0, 状態: s.state,
          メモ: 回メモ[s.no] || [],       // 新しい順
        })),
        入金: payments.map((p) => ({
          id: p.id, 日付: isoOf(p.paid_on), 金額: p.amount, 入金方法: p.method,
          区分: p.source, 付番: p.ref_no || '', メモ: p.memo || '',
          振込人: p.payer_name || '', 記録者: p.recorded_by,
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
      await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                 VALUES ($1,$2,'メモ',$3,NULL)`,
        [id, who, b.顧客メモ !== undefined ? '顧客のメモを更新した' : '顧客の情報を変更した']);
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
        await 回メモを足す(sql, id, no,
          `${jp(day)}${時刻 ? ` ${時刻}まで` : '（終日）'} に ${yen(amount)}円 の入金約束`
          + (memo ? ` — ${memo}` : ''), who);
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
        await 回メモを足す(sql, id, b.回次 ? Number(b.回次) : pr.schedule_no,
          `入金約束を変更（${変更.length ? 変更.join('、') : 'メモだけ更新'}）`
          + (memo ? ` — ${memo}` : ''), who);
        return ok(res, { done: true, もとの日: 前.日, もとの金額: 前.額 });
      }

      if (b.種類 === '約束削除') {
        const pid = Number(b.約束id);
        const pr = (await sql('SELECT * FROM promise WHERE id=$1 AND customer_id=$2', [pid, id]))[0];
        if (!pr) return bad(res, 'その約束が見つかりません。');
        await sql('DELETE FROM promise WHERE id=$1', [pid]);
        // 約束そのものは消すが、消したことは記録に残す
        await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                   VALUES ($1,$2,'約束',$3,$4)`,
          [id, who, `${isoOf(pr.promised_on)} の約束（${yen(pr.amount)}円）を取り消した`, memo]);
        await 回メモを足す(sql, id, pr.schedule_no,
          `${jp(isoOf(pr.promised_on))} の入金約束（${yen(pr.amount)}円）を取り消し`
          + (memo ? ` — ${memo}` : ''), who);
        return ok(res, { done: true });
      }

      // ── 回ごとのメモ（支払いの記録の各回の下）────────
      if (b.種類 === '回メモ') {
        const no = Number(b.回次);
        const text = String(b.本文 || '').trim();
        if (!no) return bad(res, 'どの回かを指定してください。');
        if (!text) return bad(res, 'メモを入れてください。');
        const s2 = await sql('SELECT id FROM schedule WHERE customer_id=$1 AND no=$2', [id, no]);
        if (!s2.length) return bad(res, 'その回が見つかりません。');
        const r = await sql(
          `INSERT INTO schedule_memo (customer_id, schedule_no, text, auto, created_by)
           VALUES ($1,$2,$3,false,$4) RETURNING id`, [id, no, text, who]);
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
          [id, who, `${m.schedule_no}回目のメモを消した`, m.text]);
        return ok(res, { done: true });
      }

      return bad(res, '種類が指定されていません。');
    }

    return bad(res, '対応していない操作です。');
  } catch (e) {
    fail(res, e, 'customer');
  }
};
