// 記録の保存。入金・約束・メモ・よみ・この方についてのメモ。
// 書き込みには必ず記録者を伴う(仕様:ログインは後回しでよいが「誰が」欄は最初から)。
//
// POST /api/record  {種類:'入金'|'ボーナス'|'約束'|'メモ'|'よみ'|'人メモ', ...}
const { requireSession, recordedBy } = require('./_auth');
const { db, fail, ok } = require('./_db');

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
const bad = (res, msg, why) => {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(JSON.stringify(why ? { error: msg, 理由: why } : { error: msg }));
};
const yen = (n) => Number(n).toLocaleString('ja-JP');

// その回にこれまでいくら入っているか(ボーナス分は請求と関係しないので数えない)
async function paidOn(sql, scheduleId) {
  const r = await sql(
    `SELECT COALESCE(sum(amount),0)::int AS n FROM allocation
      WHERE schedule_id=$1 AND kind IN ('元本','手数料')`, [scheduleId]);
  return r[0].n;
}

// 充当を消したあと、その回の状態を入金額から決め直す
async function restate(sql, scheduleId) {
  const s = (await sql(`SELECT planned_amount FROM schedule WHERE id=$1`, [scheduleId]))[0];
  if (!s) return;
  const n = await paidOn(sql, scheduleId);
  const state = n <= 0 ? '未入金' : (n >= s.planned_amount ? '入金済み' : '一部入金');
  await sql(`UPDATE schedule SET state=$1 WHERE id=$2`, [state, scheduleId]);
}

module.exports = async (req, res) => {
  if (!requireSession(req, res)) return;
  if ((req.method || '').toUpperCase() !== 'POST') return bad(res, 'POSTで送ってください。');
  const who = recordedBy(req);

  try {
    const sql = db();
    const b = await readBody(req);
    const id = Number(b.id);
    if (!id) return bad(res, '契約が指定されていません。');
    const c = (await sql('SELECT * FROM contract WHERE id=$1', [id]))[0];
    if (!c) return bad(res, '契約が見つかりません。');

    const memo = (b.memo || '').trim() || null;

    switch (b.種類) {

      // ── 入金。予定へ充当し、差額は契約の累計へ ─────────────
      // 1回の振込に毎月分とボーナス分が混ざることがある(実際によくある)。
      // その場合は「ボーナス分」を受け取り、1件の入金を2つに充当する(ADR-003)。
      case '入金': {
        const amount = Number(b.amount);
        if (!amount || amount <= 0) return bad(res, '金額を入れてください。');
        const method = ['振込', '現金', 'その他'].includes(b.method) ? b.method : '振込';

        const bonus = Math.max(0, Math.round(Number(b.ボーナス分) || 0));
        if (bonus > amount)
          return bad(res, `ボーナス分が入金額を超えています。（入金 ${yen(amount)}円 / ボーナス分 ${yen(bonus)}円）`);
        if (bonus > c.bonus_remaining)
          return bad(res, `ボーナス分が見込みの残りを超えています。（残り ${yen(c.bonus_remaining)}円）`);
        const monthly = amount - bonus;          // 毎月分に充てる額

        // 充当先 = 未入金でいちばん古い回。毎月分が0なら回は消し込まない
        const target = monthly > 0 ? (await sql(
          `SELECT id, no, planned_amount FROM schedule
            WHERE contract_id=$1 AND state <> '入金済み' ORDER BY no LIMIT 1`, [id]))[0] : null;

        const pay = (await sql(
          `INSERT INTO payment (contract_id, paid_on, amount, method, recorded_by, source)
           VALUES ($1, current_date, $2, $3, $4, '手入力') RETURNING id`,
          [id, amount, method, who]))[0];

        // 毎月分は元本75:手数料25で按分(仕様の定率)。ボーナス分は別の充当にする
        if (monthly > 0) {
          const moto = Math.round(monthly * 0.75);
          await sql(`INSERT INTO allocation (payment_id, schedule_id, amount, kind)
                     VALUES ($1,$2,$3,'元本'), ($1,$2,$4,'手数料')`,
            [pay.id, target ? target.id : null, moto, monthly - moto]);
        }
        if (bonus > 0) {
          await sql(`INSERT INTO allocation (payment_id, schedule_id, amount, kind)
                     VALUES ($1, NULL, $2, 'ボーナス')`, [pay.id, bonus]);
        }

        // 分割入金に対応する。その回にいくら入っているかを数え、
        // 足りていなければ「一部入金」のままにして残りを持つ。
        // 満額に届いたときだけ消し込み、そこではじめて過不足を見る。
        const planned = target ? target.planned_amount : c.monthly_amount;
        // paidOn は今いれた充当も含む(この行より前で充当を書いているため)
        const after = target ? await paidOn(sql, target.id) : 0;
        const 残り = Math.max(0, planned - after);
        const 完了 = target ? after >= planned : false;

        if (target) {
          await sql(`UPDATE schedule SET state=$1 WHERE id=$2`,
            [完了 ? '入金済み' : '一部入金', target.id]);
        }

        // 差額は「その回が終わったとき」だけ動かす(途中の不足は残りとして持つ)
        let diff = c.balance_diff, tail = '';
        if (b.差額 === '精算') { diff = 0; tail = '差額を精算した'; }
        else if (完了) {
          const d = after - planned;
          if (d !== 0) { diff = c.balance_diff + d;
            tail = `過不足は ${d < 0 ? '不足' : '余り'} ${yen(Math.abs(diff))}円 になった`; }
        }
        const left = Math.max(0, c.bonus_remaining - bonus);
        await sql(`UPDATE contract SET balance_diff=$1, bonus_remaining=$2, updated_at=now()
                    WHERE id=$3`, [diff, left, id]);

        // 満額に届いていないときは、残りをはっきり書く(電話で聞かれるため)
        const 内訳 = 完了 || !target ? ''
          : `。この回の残り ${yen(残り)}円（請求 ${yen(planned)}円 のうち ${yen(after)}円 入金済み）`;
        const text = bonus > 0
          ? (monthly > 0
              ? `${yen(amount)}円 を受け取り（毎月分 ${yen(monthly)}円／請求 ${yen(planned)}円、`
                + `ボーナス分 ${yen(bonus)}円／見込みの残り ${yen(left)}円）${tail ? '。' + tail : ''}${内訳}`
              : `ボーナス入金 ${yen(bonus)}円 を受け取り（見込みの残り ${yen(left)}円）`)
          : `${yen(amount)}円 を受け取り（請求 ${yen(planned)}円）${tail ? '。' + tail : ''}${内訳}`;
        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, target ? target.no : null, who,
           monthly > 0 ? '入金' : 'ボーナス', text, memo]);

        return ok(res, { done: true, 回次: target ? target.no : null,
                         過不足: diff, 毎月分: monthly, ボーナス分: bonus, ボーナス見込み: left,
                         この回の残り: 残り, この回は完了: 完了 });
      }

      // ── ボーナス入金。見込みから差し引く ─────────────────
      case 'ボーナス': {
        const amount = Number(b.amount);
        if (!amount || amount <= 0) return bad(res, '金額を入れてください。');
        const pay = (await sql(
          `INSERT INTO payment (contract_id, paid_on, amount, method, recorded_by, source)
           VALUES ($1, current_date, $2, '振込', $3, '手入力') RETURNING id`, [id, amount, who]))[0];
        await sql(`INSERT INTO allocation (payment_id, schedule_id, amount, kind)
                   VALUES ($1, NULL, $2, 'ボーナス')`, [pay.id, amount]);
        const left = Math.max(0, c.bonus_remaining - amount);
        await sql(`UPDATE contract SET bonus_remaining=$1, updated_at=now() WHERE id=$2`, [left, id]);
        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,NULL,$2,'ボーナス',$3,$4)`,
          [id, who, `ボーナス入金 ${yen(amount)}円 を受け取り（見込みの残り ${yen(left)}円）`, memo]);
        return ok(res, { done: true, ボーナス見込み: left });
      }

      // ── 後日の約束。分割(3日後に半分・5日後に半分)を何件でも受ける ────
      // 期日は「いちばん早い、まだ果たされていない約束の日」に合わせる。
      // 分割で何件足しても期日が跳ね回らないようにするため。
      case '約束': {
        const day = String(b.day || '');            // YYYY-MM-DD
        const amount = Number(b.amount);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad(res, '約束の日付を入れてください。');
        if (!amount || amount <= 0) return bad(res, '約束の金額を入れてください。');
        if (!memo) return bad(res, '約束のときに言われたことをメモに残してください。');

        const target = (await sql(
          `SELECT id, no, due_date, planned_amount FROM schedule
            WHERE contract_id=$1 AND state <> '入金済み' ORDER BY no LIMIT 1`, [id]))[0];
        const prev = target ? target.due_date : null;

        await sql(`INSERT INTO promise (contract_id, heard_on, promised_on, amount, heard_by, memo, prev_due_date)
                   VALUES ($1, current_date, $2, $3, $4, $5, $6)`,
          [id, day, amount, who, memo, prev]);

        // 期日は、これから来る約束のうちいちばん早い日にそろえる
        let 新期日 = null;
        if (target) {
          const first = (await sql(
            `SELECT min(promised_on) AS d FROM promise
              WHERE contract_id=$1 AND promised_on >= current_date`, [id]))[0];
          if (first && first.d) {
            新期日 = new Date(first.d).toISOString().slice(0, 10);
            await sql(`UPDATE schedule SET due_date=$1 WHERE id=$2`, [新期日, target.id]);
          }
        }

        // その回の残りと、約束の合計を出す(電話で「あといくら」と聞かれるため)
        const 残り = target
          ? Math.max(0, target.planned_amount - (await paidOn(sql, target.id))) : 0;
        const 約束合計 = target ? (await sql(
          `SELECT COALESCE(sum(amount),0)::int AS n FROM promise
            WHERE contract_id=$1 AND promised_on >= current_date`, [id]))[0].n : 0;

        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,$2,$3,'約束',$4,$5)`,
          [id, target ? target.no : null, who,
           `${day} に ${yen(amount)}円 を支払うと約束`
           + (target ? `（この回の残り ${yen(残り)}円 / 約束の合計 ${yen(約束合計)}円）` : '')
           + (prev && 新期日 && new Date(prev).toISOString().slice(0,10) !== 新期日
              ? `。期日を ${new Date(prev).toISOString().slice(0,10)} から ${新期日} に変更` : ''), memo]);
        return ok(res, { done: true, 約束の日: day, 期日: 新期日,
                         この回の残り: 残り, 約束の合計: 約束合計 });
      }

      // ── 約束を動かす。日付・金額・メモを入れ直す ──────────────
      // 「やっぱり5日にして」「1万にして」が電話で普通に来る。
      // 消さずに書き換え、動かしたことを記録に残す。
      case '約束変更': {
        const pid = Number(b.約束id);
        const day = String(b.day || '');
        const amount = Number(b.amount);
        if (!pid) return bad(res, 'どの約束かを指定してください。');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad(res, '約束の日付を入れてください。');
        if (!amount || amount <= 0) return bad(res, '約束の金額を入れてください。');

        const pr = (await sql(
          `SELECT * FROM promise WHERE id=$1 AND contract_id=$2`, [pid, id]))[0];
        if (!pr) return bad(res, 'その約束が見つかりません。');
        const 前の日 = new Date(pr.promised_on).toISOString().slice(0, 10);
        const 前の額 = pr.amount;
        if (前の日 === day && 前の額 === amount && !memo)
          return ok(res, { done: true, 変更なし: true });

        await sql(`UPDATE promise SET promised_on=$1, amount=$2, memo=$3 WHERE id=$4`,
          [day, amount, memo || pr.memo, pid]);

        // 期日は、これから来る約束のうちいちばん早い日にそろえ直す
        const target = (await sql(
          `SELECT id, no, planned_amount FROM schedule
            WHERE contract_id=$1 AND state <> '入金済み' ORDER BY no LIMIT 1`, [id]))[0];
        let 新期日 = null;
        if (target) {
          const f = (await sql(
            `SELECT min(promised_on) AS d FROM promise
              WHERE contract_id=$1 AND promised_on >= current_date`, [id]))[0];
          if (f && f.d) {
            新期日 = new Date(f.d).toISOString().slice(0, 10);
            await sql(`UPDATE schedule SET due_date=$1 WHERE id=$2`, [新期日, target.id]);
          }
        }
        const 残り = target
          ? Math.max(0, target.planned_amount - (await paidOn(sql, target.id))) : 0;

        const 変更 = [];
        if (前の日 !== day) 変更.push(`日を ${前の日} から ${day} へ`);
        if (前の額 !== amount) 変更.push(`金額を ${yen(前の額)}円 から ${yen(amount)}円 へ`);
        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,$2,$3,'約束',$4,$5)`,
          [id, target ? target.no : null, who,
           `約束を動かした（${変更.length ? 変更.join('、') : 'メモだけ更新'}）`
           + (target ? `。この回の残り ${yen(残り)}円` : ''), memo]);
        return ok(res, { done: true, 約束の日: day, 金額: amount,
                         期日: 新期日, この回の残り: 残り,
                         もとの日: 前の日, もとの金額: 前の額 });
      }

      // ── 督促をとめる / 再開する ────────────────────
      // 事情のある方に催促を続けないための欄。理由は必ず書いてもらう。
      case '督促とめ': {
        if (!memo) return bad(res, 'とめる理由を書いてください。',
          '（例：入院中、弁護士が入った、社長が直接話す など）');
        const until = String(b.until || '');
        if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until))
          return bad(res, 'いつまでの日付が読めません。');
        await sql(`UPDATE contract SET dunning_reason=$1, dunning_by=$2,
                     dunning_at=now(), dunning_until=$3, updated_at=now() WHERE id=$4`,
          [memo, who, until || null, id]);
        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,NULL,$2,'メモ',$3,$4)`,
          [id, who, `督促をとめた${until ? `（${until} まで）` : '（期限なし）'}`, memo]);
        return ok(res, { done: true, 督促: 'とめた', 理由: memo, いつまで: until || null });
      }

      case '督促再開': {
        if (!c.dunning_reason) return bad(res, 'この方の督促はとまっていません。');
        const 前の理由 = c.dunning_reason;
        await sql(`UPDATE contract SET dunning_reason=NULL, dunning_by=NULL,
                     dunning_at=NULL, dunning_until=NULL, updated_at=now() WHERE id=$1`, [id]);
        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,NULL,$2,'メモ',$3,$4)`,
          [id, who, `督促を再開した（とめていた理由：${前の理由}）`, memo]);
        return ok(res, { done: true, 督促: '再開', もとの理由: 前の理由 });
      }

      // ── 回ごとの期日の変更(入金カレンダーから)──────────────
      // もとの期日は記録に残す。入金済みの回は変えない(記録が食い違うため)。
      case '期日変更': {
        const no = Number(b.no);
        const day = String(b.day || '');
        if (!no) return bad(res, '何回目かを指定してください。');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad(res, '日付を入れてください。');
        const s = (await sql(
          `SELECT id, no, due_date, state FROM schedule WHERE contract_id=$1 AND no=$2`,
          [id, no]))[0];
        if (!s) return bad(res, 'その回が見つかりません。');
        if (s.state === '入金済み')
          return bad(res, '入金済みの回は期日を変えられません。',
            '取り消してから入れ直してください。');
        const prev = new Date(s.due_date).toISOString().slice(0, 10);
        if (prev === day) return ok(res, { done: true, 変更なし: true, 回次: no, 期日: day });

        await sql(`UPDATE schedule SET due_date=$1 WHERE id=$2`, [day, s.id]);
        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,$2,$3,'約束',$4,$5)`,
          [id, no, who, `${no}回目の期日を ${prev} から ${day} に変更`, memo]);
        return ok(res, { done: true, 回次: no, 期日: day, もとの期日: prev });
      }

      // ── その回のメモ(追記のみ)────────────────────
      case 'メモ': {
        if (!memo) return bad(res, 'メモを入れてください。');
        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,$2,$3,'メモ',$4,NULL)`,
          [id, b.no ? Number(b.no) : null, who, memo]);
        return ok(res, { done: true });
      }

      // ── この方についてのメモ(書き直せる欄)───────────────
      case '人メモ': {
        await sql(`UPDATE contract SET memo=$1, updated_at=now() WHERE id=$2`, [b.memo || '', id]);
        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,NULL,$2,'メモ','この方についてのメモを更新した',NULL)`, [id, who]);
        return ok(res, { done: true });
      }

      // ── よみ(あいうえお順に使う)──────────────────
      case 'よみ': {
        const kana = (b.kana || '').trim();
        if (!kana) return bad(res, 'よみを入れてください。');
        await sql(`UPDATE contract SET kana=$1, updated_at=now() WHERE id=$2`, [kana, id]);
        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,NULL,$2,'メモ',$3,NULL)`,
          [id, who, `よみを「${kana}」として登録した`]);
        return ok(res, { done: true });
      }

      // ── 取消(元に戻す)。直前の入金を取り消し、取消の記録を足す ──────
      // 記録は消さずに「取り消した」を追記する(ADR-005)。金額の側は元に戻す。
      case '取消': {
        const last = (await sql(
          `SELECT * FROM payment WHERE contract_id=$1 ORDER BY id DESC LIMIT 1`, [id]))[0];
        if (!last) return bad(res, '取り消せる入金がありません。');
        // 毎月分とボーナス分が混ざっていることがあるので、両方それぞれ戻す
        const kinds = await sql(`SELECT kind, amount FROM allocation WHERE payment_id=$1`, [last.id]);
        const sum = (k) => kinds.filter(x => x.kind === k).reduce((s, x) => s + x.amount, 0);
        const bonusAmt = sum('ボーナス');
        const monthlyAmt = sum('元本') + sum('手数料');

        const sc = (await sql(
          `SELECT schedule_id FROM allocation WHERE payment_id=$1 AND schedule_id IS NOT NULL LIMIT 1`,
          [last.id]))[0];

        if (bonusAmt > 0) {
          await sql(`UPDATE contract SET bonus_remaining = bonus_remaining + $1, updated_at=now()
                      WHERE id=$2`, [bonusAmt, id]);
        }
        // 過不足はその回が終わったときだけ動かしているので、戻すのも終わっていた回だけ
        if (monthlyAmt > 0 && sc) {
          const s = (await sql(`SELECT planned_amount, state FROM schedule WHERE id=$1`,
            [sc.schedule_id]))[0];
          if (s && s.state === '入金済み') {
            const d = (await paidOn(sql, sc.schedule_id)) - s.planned_amount;
            if (d !== 0) await sql(`UPDATE contract SET balance_diff = balance_diff - $1, updated_at=now()
                                     WHERE id=$2`, [d, id]);
          }
        }
        await sql(`DELETE FROM allocation WHERE payment_id=$1`, [last.id]);
        await sql(`DELETE FROM payment WHERE id=$1`, [last.id]);
        // 分割入金があるので、残った充当から状態を決め直す(いつも未入金に戻すわけではない)
        if (sc) await restate(sql, sc.schedule_id);
        const what = bonusAmt > 0
          ? (monthlyAmt > 0
              ? `入金（毎月分 ${yen(monthlyAmt)}円／ボーナス分 ${yen(bonusAmt)}円）`
              : 'ボーナス入金')
          : '入金';
        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,NULL,$2,'取消',$3,NULL)`,
          [id, who, `${yen(last.amount)}円 の${what}を取り消した`]);
        return ok(res, { done: true, 取り消した金額: last.amount });
      }

      default:
        return bad(res, '種類が指定されていません。');
    }
  } catch (e) {
    fail(res, e, 'record');
  }
};
