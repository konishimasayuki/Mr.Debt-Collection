// すでに入っている入金の、ボーナスの回への充当を外して、月額の回に付け直す。
//
// GET  /api/repair            … 調べるだけ（1円も動かさない）
// POST /api/repair {実行:true} … 付け直す
//
// 自動で取り込んだ入金は、いまはボーナスの回に充てない（api/_intake.js）。
// ただし、その決まりより前に取り込んだ入金は、ボーナスの回に入ったままになっている。
// 期日が同じだと金額の大きいボーナスの回が先に埋まり、月々の回が未入金で残る。
//
// 人が「入金種類：ボーナス」と決めた入金には触らない。それは正しい充当のため。
// 逆に言うと、本当はボーナス分なのに種類を決めていない入金は、月額の回から
// あふれて「余り」になる。余りは画面に出すので、入金履歴で種類を
// 「ボーナス」に直してから、もう一度押してもらえばよい。
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, isoOf, yen, restateMany } from './_lib.js';

const bad = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

// ── 付け直したらどうなるかを、頭の中だけで解く ─────────────
//
// データベースの取引（BEGIN/COMMIT）は使えない。Neonへの問い合わせは
// 1回ずつ別々に飛ぶので、途中で戻せないため。
// だから「調べるだけ」も「付け直す」も、まったく同じこの計算を通す。
// 見せた数字と、押したあとの結果が食い違わない。
function 組み直しを解く(顧客id, 予定, 充当, 入金) {
  const 据え置き = new Set(入金.filter((p) => p.alloc_kind === 'ボーナス').map((p) => p.id));
  const 動かす = 入金.filter((p) => !据え置き.has(p.id))
    .sort((a, b) => String(isoOf(a.paid_on)).localeCompare(String(isoOf(b.paid_on))) || a.id - b.id);

  // 各回に「もともと入っている額」。人が決めたボーナスの入金だけは残す
  const 埋まり = new Map(予定.map((s) => [s.id, 0]));
  const 元の充当合計 = 充当.reduce((a, x) => a + x.amount, 0);
  充当.forEach((x) => {
    if (据え置き.has(x.payment_id)) 埋まり.set(x.schedule_id, (埋まり.get(x.schedule_id) || 0) + x.amount);
  });

  // 充てる先は月額（通常）の回だけ。期日の古い順
  const 通常 = 予定.filter((s) => (s.kind || '通常') === '通常')
    .sort((a, b) => String(isoOf(a.due_date)).localeCompare(String(isoOf(b.due_date))) || a.no - b.no);

  const 新しい充当 = [];
  const 余りの明細 = [];
  for (const p of 動かす) {
    let 残 = p.amount;
    for (const s of 通常) {
      if (残 <= 0) break;
      const あき = s.planned_amount - (埋まり.get(s.id) || 0);
      if (あき <= 0) continue;
      const 入れる = Math.min(残, あき);
      新しい充当.push({ payment_id: p.id, schedule_id: s.id, amount: 入れる });
      埋まり.set(s.id, (埋まり.get(s.id) || 0) + 入れる);
      残 -= 入れる;
    }
    if (残 > 0) {
      余りの明細.push({ 入金id: p.id, 日付: isoOf(p.paid_on), 金額: p.amount, 余り: 残 });
    }
  }

  const 新しい充当合計 = [...埋まり.values()].reduce((a, n) => a + n, 0);
  // 付け直したあとも、ボーナスの回にお金が残っているか（人が決めた入金の分）
  const ボーナスに残る = 予定.filter((s) => s.kind === 'ボーナス' && (埋まり.get(s.id) || 0) > 0).length;
  const ボーナスから外す = 予定
    .filter((s) => s.kind === 'ボーナス')
    .reduce((a, s) => a
      + Math.max(0, 充当.filter((x) => x.schedule_id === s.id).reduce((b, x) => b + x.amount, 0)
                    - (埋まり.get(s.id) || 0)), 0);

  return {
    顧客id,
    動かす入金: 動かす.map((p) => p.id),
    新しい充当,
    余りの明細,
    余り: 余りの明細.reduce((a, x) => a + x.余り, 0),
    ボーナスから外す,
    ボーナスに残る件数: ボーナスに残る,
    // 充当できない分だけ、台帳の残債は増えて見える（前受のお金になるため）
    残債が増える: Math.max(0, 元の充当合計 - 新しい充当合計),
    触る回: 予定.map((s) => s.id),
  };
}

// 直しどころのある顧客と、その材料を集める
async function 材料(sql) {
  const 対象 = await sql(
    `SELECT DISTINCT s.customer_id AS cid
       FROM allocation a
       JOIN schedule s ON s.id = a.schedule_id
       JOIN payment  p ON p.id = a.payment_id
      WHERE s.kind = 'ボーナス'
        AND COALESCE(p.alloc_kind, '') <> 'ボーナス'
      ORDER BY 1`);
  const ids = 対象.map((r) => r.cid);
  if (!ids.length) return { ids: [], 名: {}, 予定: [], 充当: [], 入金: [] };

  // 顧客ごとに聞き直さない。3つまとめて、同時に取る
  const [顧客, 予定, 充当, 入金] = await Promise.all([
    sql('SELECT id, name FROM customer WHERE id = ANY($1::int[])', [ids]),
    sql(`SELECT id, customer_id, no, kind, planned_amount, due_date
           FROM schedule WHERE customer_id = ANY($1::int[])`, [ids]),
    sql(`SELECT a.payment_id, a.schedule_id, a.amount, s.customer_id
           FROM allocation a JOIN schedule s ON s.id = a.schedule_id
          WHERE s.customer_id = ANY($1::int[])`, [ids]),
    sql(`SELECT id, customer_id, amount, paid_on, alloc_kind
           FROM payment WHERE customer_id = ANY($1::int[])`, [ids]),
  ]);
  const 名 = {};
  顧客.forEach((c) => { 名[c.id] = c.name; });
  return { ids, 名, 予定, 充当, 入金 };
}

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  const who = recordedBy(req);
  const 実行 = (req.method || '').toUpperCase() === 'POST';

  try {
    const sql = db();
    if (実行) {
      const b = await readBody(req);
      if (!b.実行) return bad(res, 400, { error: '実行するなら {実行:true} を送ってください。' });
    }

    const { ids, 名, 予定, 充当, 入金 } = await 材料(sql);
    if (!ids.length) {
      return ok(res, { 件数: 0, 直した: false, 余りが出る人数: 0, 余り合計: 0, 顧客: [] });
    }

    const 束 = (rows, key) => {
      const m = new Map(ids.map((id) => [id, []]));
      rows.forEach((r) => { const a = m.get(r[key]); if (a) a.push(r); });
      return m;
    };
    const 予定ごと = 束(予定, 'customer_id');
    const 充当ごと = 束(充当, 'customer_id');
    const 入金ごと = 束(入金, 'customer_id');

    const 解 = ids.map((cid) => 組み直しを解く(
      cid, 予定ごと.get(cid), 充当ごと.get(cid), 入金ごと.get(cid)));

    if (実行) {
      // 取引は使えないので、動かす数をできるだけ少なくする。
      // 全員ぶんをまとめて「消す→入れる→状態を直す」の3段で終わらせる
      const 消す = 解.flatMap((x) => x.動かす入金);
      const 入れる = 解.flatMap((x) => x.新しい充当);
      const 直す回 = [...new Set(解.flatMap((x) => x.触る回))];

      await sql('DELETE FROM allocation WHERE payment_id = ANY($1::int[])', [消す]);
      if (入れる.length) {
        const 値 = [], 引数 = [];
        入れる.forEach((a) => {
          引数.push(a.payment_id, a.schedule_id, a.amount);
          const i = 引数.length;
          値.push(`($${i - 2},$${i - 1},$${i})`);
        });
        await sql(`INSERT INTO allocation (payment_id, schedule_id, amount)
                   VALUES ${値.join(',')}`, 引数);
      }
      await restateMany(sql, 直す回);

      // 誰が何をしたかを残す。あとから「金額が変わった」と言われたときに追える
      const 値 = [], 引数 = [];
      解.forEach((x) => {
        引数.push(x.顧客id, who,
          'ボーナスの回に自動で入っていた入金を、月額の回に付け直しました'
          + (x.ボーナスから外す ? `（ボーナスの回から ${yen(x.ボーナスから外す)}円 を外しました）` : '')
          + (x.余り ? `。${yen(x.余り)}円 は月額の回に充てきれず余りになりました` : ''));
        const i = 引数.length;
        値.push(`($${i - 2},$${i - 1},'記録',$${i})`);
      });
      await sql(`INSERT INTO event (customer_id, recorded_by, kind, text)
                 VALUES ${値.join(',')}`, 引数);
    }

    return ok(res, {
      件数: 解.length,
      直した: 実行,
      余りが出る人数: 解.filter((x) => x.余り > 0).length,
      余り合計: 解.reduce((a, x) => a + x.余り, 0),
      顧客: 解
        .map((x) => ({
          顧客id: x.顧客id, 顧客名: 名[x.顧客id] || '',
          ボーナスから外す: x.ボーナスから外す,
          ボーナスに残る件数: x.ボーナスに残る件数,
          余り: x.余り, 余りの明細: x.余りの明細, 残債が増える: x.残債が増える,
        }))
        .sort((a, b) => b.余り - a.余り || b.ボーナスから外す - a.ボーナスから外す),
    });
  } catch (e) {
    fail(res, e, 'repair');
  }
};
