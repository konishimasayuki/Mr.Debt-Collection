// 新しいお客さん(契約)の登録。48回ぶんの支払予定もここで作る。
//
// POST /api/customer {name, kana, car, monthly, price, pay_day, start, bonus_months, bonus_each, contact}
//
// 手数料は支払総額の25%(仕様の定率)。車の代金(price)は確認用で、
// 計算した元本と食い違うときは登録を止めずに知らせる。
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
const yen = (n) => Number(n).toLocaleString('ja-JP');
const bad = (res, msg, why) => {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(JSON.stringify(why ? { error: msg, 理由: why } : { error: msg }));
};

// その月の末日
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// 回次kの支払期日。その月に支払日が無ければ末日にする(2月31日→2月28日)
function dueOf(y0, m0, day, k) {
  const t = y0 * 12 + (m0 - 1) + (k - 1);
  const y = Math.floor(t / 12), m = t % 12 + 1;
  const d = Math.min(day, lastDay(y, m));
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 入力を整える。全角カナに寄せる(名寄せと同じ形)
function tidyKana(s) {
  return String(s || '').normalize('NFKC').replace(/[\s　]/g, '')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)).trim();
}
const isKana = (s) => /^[ァ-ヺー]+$/.test(s);

module.exports = async (req, res) => {
  if (!requireSession(req, res)) return;
  if ((req.method || '').toUpperCase() !== 'POST') return bad(res, 'POSTで送ってください。');
  const who = recordedBy(req);

  try {
    const sql = db();
    const b = await readBody(req);

    const name = String(b.name || '').trim();
    const monthly = Math.round(Number(b.monthly) || 0);
    const term = 48;
    if (!name) return bad(res, 'お名前を入れてください。');
    if (!monthly || monthly <= 0) return bad(res, '毎月の額を入れてください。');

    const day = Math.min(Math.max(Math.round(Number(b.pay_day) || 27), 1), 31);
    const m = String(b.start || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return bad(res, '開始月を選んでください。');
    const y0 = +m[1], m0 = +m[2];
    if (m0 < 1 || m0 > 12) return bad(res, '開始月を選んでください。');

    const kana = tidyKana(b.kana);
    if (kana && !isKana(kana))
      return bad(res, 'よみはカナで入れてください。', `「${b.kana}」は読み取れません`);

    const months = (Array.isArray(b.bonus_months) ? b.bonus_months : [])
      .map(Number).filter((n) => n >= 1 && n <= 12);
    const each = Math.max(0, Math.round(Number(b.bonus_each) || 0));
    const bonusTotal = each * months.length * 4;          // 1回あたり × 年の回数 × 4年

    const total = monthly * term + bonusTotal;
    const fee = Math.round(total * 0.25);
    const purchase = total - fee;

    // 二重登録を止める。同じお名前・同じ毎月額・同じ開始月は同じ契約とみなす
    const start = dueOf(y0, m0, day, 1);
    const dup = await sql(
      `SELECT id FROM contract WHERE name=$1 AND monthly_amount=$2 AND start_date=$3`,
      [name, monthly, start]);
    if (dup.length)
      return bad(res, 'この契約はすでに登録されています。',
        `${name}さん・毎月 ${yen(monthly)}円・${y0}年${m0}月開始（契約番号 ${dup[0].id}）`);

    // 同姓同名が別にいるときは、止めずに知らせる(実際に同姓の方がいるため)
    const same = await sql(`SELECT id FROM contract WHERE name=$1`, [name]);

    const ins = await sql(
      `INSERT INTO contract
         (name, kana, car, tel, email, purchase_amount, fee_amount, total_amount,
          monthly_amount, term_count, pay_day, start_date, bonus_months, bonus_each,
          bonus_remaining, memo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [name, kana || null, String(b.car || '').trim() || null,
       String(b.tel || '').trim() || null, String(b.email || '').trim() || null,
       purchase, fee, total, monthly, term, day, start,
       months, each, bonusTotal, String(b.memo || '').trim() || null]);
    const id = ins[0].id;

    // 支払予定48回。予定額は毎月額のみ(ADR-002)
    for (let k = 1; k <= term; k++) {
      await sql(`INSERT INTO schedule (contract_id, no, due_date, planned_amount)
                 VALUES ($1,$2,$3,$4) ON CONFLICT (contract_id, no) DO NOTHING`,
        [id, k, dueOf(y0, m0, day, k), monthly]);
    }

    // よみを入れてあれば名寄せ辞書にも入れる(初回の振込から自動で当たる)
    if (kana) {
      await sql(`INSERT INTO payer_alias (normalized_name, contract_id, created_by)
                 VALUES ($1,$2,$3) ON CONFLICT (normalized_name) DO NOTHING`, [kana, id, who]);
    }

    const last = dueOf(y0, m0, day, term);
    await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
               VALUES ($1,1,$2,'メモ',$3,$4)`,
      [id, who,
       `新しいお客さん（${name}／${String(b.car || '').trim() || '車両未記入'}）を登録`
       + `：毎月 ${yen(monthly)}円 × ${term}回、${start} から ${last} まで`
       + (bonusTotal ? `、ボーナス見込み ${yen(bonusTotal)}円（${months.join('・')}月 × ${yen(each)}円）` : ''),
       String(b.memo || '').trim() || null]);

    // 車の代金は確認用。食い違っても登録は止めず、記録に残して人に知らせる
    const price = Math.round(Number(b.price) || 0);
    let 検算 = null;
    if (price) {
      const df = price - purchase;
      検算 = { 車の代金: price, 計算した元本: purchase, 差: df, 一致: Math.abs(df) <= 100 };
      if (!検算.一致) {
        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,NULL,$2,'メモ',$3,NULL)`,
          [id, who, `要確認:車の代金 ${yen(price)}円 と、毎月額から計算した元本 ${yen(purchase)}円 が`
                    + ` ${yen(Math.abs(df))}円 ちがいます`]);
      }
    }

    return ok(res, { done: true, id, name,
      支払総額: total, 手数料: fee, 元本: purchase,
      初回: start, 最終回: last, ボーナス見込み: bonusTotal,
      検算,
      同姓同名: same.length ? same.length + 1 : 0 });
  } catch (e) {
    fail(res, e, 'customer');
  }
};
