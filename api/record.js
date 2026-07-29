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
const bad = (res, msg) => {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(JSON.stringify({ error: msg }));
};
const yen = (n) => Number(n).toLocaleString('ja-JP');

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

        if (target) await sql(`UPDATE schedule SET state='入金済み' WHERE id=$1`, [target.id]);

        // 差額は毎月分だけで見る(ボーナス分は請求と関係しない)
        const planned = target ? target.planned_amount : c.monthly_amount;
        const d = monthly - planned;
        let diff = c.balance_diff, tail = '';
        if (b.差額 === '精算') { diff = 0; tail = '差額を精算した'; }
        else if (monthly > 0 && d !== 0) { diff = c.balance_diff + d;
          tail = `過不足は ${d < 0 ? '不足' : '余り'} ${yen(Math.abs(diff))}円 になった`; }
        const left = Math.max(0, c.bonus_remaining - bonus);
        await sql(`UPDATE contract SET balance_diff=$1, bonus_remaining=$2, updated_at=now()
                    WHERE id=$3`, [diff, left, id]);

        const text = bonus > 0
          ? (monthly > 0
              ? `${yen(amount)}円 を受け取り（毎月分 ${yen(monthly)}円／請求 ${yen(planned)}円、`
                + `ボーナス分 ${yen(bonus)}円／見込みの残り ${yen(left)}円）${tail ? '。' + tail : ''}`
              : `ボーナス入金 ${yen(bonus)}円 を受け取り（見込みの残り ${yen(left)}円）`)
          : `${yen(amount)}円 を受け取り（請求 ${yen(planned)}円）${tail ? '。' + tail : ''}`;
        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, target ? target.no : null, who,
           monthly > 0 ? '入金' : 'ボーナス', text, memo]);

        return ok(res, { done: true, 回次: target ? target.no : null,
                         過不足: diff, 毎月分: monthly, ボーナス分: bonus, ボーナス見込み: left });
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

      // ── 後日の約束。期日も更新し、もとの期日を残す ───────────
      case '約束': {
        const day = String(b.day || '');            // YYYY-MM-DD
        const amount = Number(b.amount);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad(res, '約束の日付を入れてください。');
        if (!amount || amount <= 0) return bad(res, '約束の金額を入れてください。');
        if (!memo) return bad(res, '約束のときに言われたことをメモに残してください。');

        const target = (await sql(
          `SELECT id, no, due_date FROM schedule
            WHERE contract_id=$1 AND state <> '入金済み' ORDER BY no LIMIT 1`, [id]))[0];
        const prev = target ? target.due_date : null;

        await sql(`INSERT INTO promise (contract_id, heard_on, promised_on, amount, heard_by, memo, prev_due_date)
                   VALUES ($1, current_date, $2, $3, $4, $5, $6)`,
          [id, day, amount, who, memo, prev]);
        if (target) await sql(`UPDATE schedule SET due_date=$1 WHERE id=$2`, [day, target.id]);

        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,$2,$3,'約束',$4,$5)`,
          [id, target ? target.no : null, who,
           `${day} に ${yen(amount)}円 を支払うと約束`
           + (prev ? `（期日を ${new Date(prev).toISOString().slice(0,10)} から変更）` : ''), memo]);
        return ok(res, { done: true, 約束の日: day });
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

        // 予定を未入金に戻す(その入金で消し込んだ回)
        const sc = (await sql(
          `SELECT schedule_id FROM allocation WHERE payment_id=$1 AND schedule_id IS NOT NULL LIMIT 1`,
          [last.id]))[0];
        if (sc) await sql(`UPDATE schedule SET state='未入金' WHERE id=$1`, [sc.schedule_id]);

        if (bonusAmt > 0) {
          await sql(`UPDATE contract SET bonus_remaining = bonus_remaining + $1, updated_at=now()
                      WHERE id=$2`, [bonusAmt, id]);
        }
        if (monthlyAmt > 0 && sc) {
          const planned = (await sql(`SELECT planned_amount FROM schedule WHERE id=$1`,
            [sc.schedule_id]))[0];
          const d = monthlyAmt - (planned ? planned.planned_amount : c.monthly_amount);
          if (d !== 0) await sql(`UPDATE contract SET balance_diff = balance_diff - $1, updated_at=now()
                                   WHERE id=$2`, [d, id]);
        }
        await sql(`DELETE FROM allocation WHERE payment_id=$1`, [last.id]);
        await sql(`DELETE FROM payment WHERE id=$1`, [last.id]);
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
