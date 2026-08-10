// 顧客一覧と、新規顧客の登録。
// GET  /api/customers          … 一覧（氏名・債権譲渡会社・車種・支払日・金額・残り回数・残債）
// GET  /api/customers?未入金=1 … 支払期日までに入金できていない顧客（あいうえお順）
// POST /api/customers          … 新規登録。支払予定も同時に作る
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, query, dueOf, yen, norm, makeSchedule, remakeBonus,
         カナにそろえる, よみか } from './_lib.js';
import { 顧客一覧 } from './_list.js';
import { guess, あいうえお順 } from './_yomi_dict.js';

const bad = (res, msg, why) => {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(JSON.stringify(why ? { error: msg, 理由: why } : { error: msg }));
};

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  const method = (req.method || 'GET').toUpperCase();

  try {
    const sql = db();

    if (method === 'GET') {
      const q = query(req);

      // ── よみをまとめて入れる画面のための一覧 ──────────
      // 氏名と、いまのよみと、苗字の辞書から出した候補だけを返す。
      // 候補は「たたき台」であって正解ではない。読みが分かれる苗字は
      // 空で返し、その理由も一緒に渡す（人が必ず確かめられるように）。
      if (q['よみ']) {
        const rows = await sql(
          `SELECT id, name, kana FROM customer WHERE archived = false`);
        const list = rows.map((c) => {
          const g = guess(c.name);
          return { id: c.id, 氏名: c.name, よみ: c.kana || '',
                   候補: g.読み, 候補の理由: g.理由 };
        });
        list.sort((a, b) => あいうえお順(
          { name: a.氏名, kana: a.よみ, id: a.id },
          { name: b.氏名, kana: b.よみ, id: b.id }));
        return ok(res, {
          顧客: list,
          空の人数: list.filter((c) => !c.よみ).length,
          候補がある人数: list.filter((c) => !c.よみ && c.候補).length,
        });
      }

      // 組み立ては _list.js に置いてある。開いた直後の往復を減らすため、
      // 同じ一覧を /api/session からも返せるようにしている。
      return ok(res, await 顧客一覧(sql, q['未入金'] ? '未入金' : (q['終了'] ? '終了' : '')));
    }

    if (method === 'POST') {
      const who = recordedBy(req);
      const b = await readBody(req);

      const name = String(b.名前 || '').trim();
      const monthly = Math.round(Number(b.月々の金額) || 0);
      if (!name) return bad(res, 'お名前を入れてください。');
      if (!monthly || monthly <= 0) return bad(res, '月々の金額を入れてください。');

      const term = Math.max(1, Math.round(Number(b.回数) || 48));
      const payDay = Math.min(Math.max(Math.round(Number(b.支払日) || 27), 1), 31);

      // 開始月。指定が無ければ契約日の翌月から
      let y0, m0;
      const st = String(b.開始月 || '').match(/^(\d{4})-(\d{2})$/);
      if (st) { y0 = +st[1]; m0 = +st[2]; }
      else {
        const base = b.契約日 ? new Date(b.契約日) : new Date();
        if (isNaN(base)) return bad(res, '契約日が読めません。');
        const t = base.getFullYear() * 12 + base.getMonth() + 1;
        y0 = Math.floor(t / 12); m0 = (t % 12) + 1;
      }
      if (m0 < 1 || m0 > 12) return bad(res, '開始月が読めません。');
      const start = dueOf(y0, m0, payDay, 1);

      // 会社の指定があれば実在を確かめる
      for (const [key, col] of [['債権譲渡会社', 'assignor'], ['債権譲渡先', 'assignee']]) {
        const v = b[key];
        if (v) {
          const c = await sql('SELECT id FROM company WHERE id=$1', [Number(v)]);
          if (!c.length) return bad(res, `${key}が見つかりません。`, '設定で登録してください');
        }
      }

      // 二重登録を止める(同じ氏名・同じ月額・同じ開始日は同じ契約とみなす)
      const dup = await sql(
        `SELECT id FROM customer WHERE name=$1 AND monthly_amount=$2 AND start_date=$3
           AND archived=false`, [name, monthly, start]);
      if (dup.length) {
        return bad(res, 'この顧客はすでに登録されています。',
          `${name}さん・月々 ${yen(monthly)}円・${start} 開始（顧客番号 ${dup[0].id}）`);
      }
      const same = await sql('SELECT id FROM customer WHERE name=$1 AND archived=false', [name]);

      const total = monthly * term;
      const ins = await sql(
        `INSERT INTO customer
           (name, kana, gender, birthday, address, tel, contract_date, car,
            assignor_id, assignee_id, monthly_amount, term_count, pay_day,
            start_date, total_amount, memo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [name, String(b.よみ || '').trim() || null,
         String(b.性別 || '').trim() || null,
         b.生年月日 || null,
         String(b.住所 || '').trim() || null,
         String(b.電話番号 || '').trim() || null,
         b.契約日 || null,
         String(b.車種 || '').trim() || null,
         b.債権譲渡会社 ? Number(b.債権譲渡会社) : null,
         b.債権譲渡先 ? Number(b.債権譲渡先) : null,
         monthly, term, payDay, start, total,
         String(b.メモ || '').trim() || null]);
      const id = ins[0].id;

      await makeSchedule(sql, id, y0, m0, payDay, term, monthly);

      // ボーナス払いの指定があれば、その予定も作って支払総額に足す
      const ボ月 = [...new Set((b.ボーナス月 || []).map(Number)
        .filter((m) => m >= 1 && m <= 12))].sort((x, y) => x - y);
      const ボ日 = Number(b.ボーナス日) || null;
      const ボ額 = Math.round(Number(b.ボーナス金額)) || null;
      if (ボ月.length) {
        if (!ボ日 || ボ日 < 1 || ボ日 > 31) return bad(res, 'ボーナスの支払日を1〜31で入れてください。');
        if (!ボ額 || ボ額 <= 0) return bad(res, 'ボーナスの金額を入れてください。');
        await remakeBonus(sql, id, y0, m0, payDay, term, ボ月, ボ日, ボ額);
        const ボ合計 = (await sql(
          `SELECT COALESCE(sum(planned_amount),0)::int AS n FROM schedule
            WHERE customer_id=$1 AND kind='ボーナス'`, [id]))[0].n;
        await sql(`UPDATE customer SET bonus_months=$1, bonus_day=$2, bonus_amount=$3,
                     total_amount=$4 WHERE id=$5`,
          [ボ月, ボ日, ボ額, total + ボ合計, id]);
      }
      if (b.よみ) {
        await sql(`INSERT INTO payer_alias (normalized_name, customer_id, created_by)
                   VALUES ($1,$2,$3) ON CONFLICT (normalized_name) DO NOTHING`,
          [norm(b.よみ), id, who]);
      }
      await sql(`INSERT INTO event (customer_id, recorded_by, kind, text, memo)
                 VALUES ($1,$2,'登録',$3,$4)`,
        [id, who,
         `新規登録：月々 ${yen(monthly)}円 × ${term}回、${start} から ${dueOf(y0, m0, payDay, term)} まで`,
         String(b.メモ || '').trim() || null]);

      return ok(res, { done: true, id, 氏名: name, 初回: start,
        最終回: dueOf(y0, m0, payDay, term), 支払総額: total,
        同姓同名: same.length ? same.length + 1 : 0 });
    }

    // ── まとめて直す ──────────────────────────
    // 債権譲渡が起きると、複数の顧客の会社が一度に変わる。1件ずつ開かせない。
    // PATCH /api/customers {債権譲渡会社:id}          … 全顧客に当てる
    // PATCH /api/customers {債権譲渡先:id, 対象:[…]}  … 指定した顧客だけ
    // PATCH /api/customers {よみ:[{id, よみ}, …]}     … よみをまとめて入れる
    if (method === 'PATCH') {
      const who = recordedBy(req);
      const b = await readBody(req);

      // ── よみをまとめて入れる ────────────────
      // よみが空だと、CSVの振込人名から顧客を当てられない。
      // 1件ずつ顧客ページを開いて入れるのは、人数が多いと現実的でない。
      if (Array.isArray(b['よみ'])) {
        const 直す = [];
        for (const x of b['よみ']) {
          const id = Number(x && x.id);
          if (!id) continue;
          const k = カナにそろえる(x['よみ']);
          if (k && !よみか(k)) {
            return bad(res, `「${k}」は よみ として読めません。`,
              'カタカナ（またはひらがな）で入れてください');
          }
          直す.push({ id, よみ: k });
        }
        if (!直す.length) return bad(res, '直す相手がいません。');

        // 変えるものだけを数えたいので、今の中身も一緒に見る
        const 今 = await sql(
          'SELECT id, name, kana FROM customer WHERE id = ANY($1::int[])',
          [直す.map((x) => x.id)]);
        const 今の = {};
        今.forEach((c) => (今の[c.id] = c));
        const 変わる = 直す.filter((x) => 今の[x.id] && (今の[x.id].kana || '') !== x.よみ);
        if (!変わる.length) return ok(res, { done: true, 変えた人数: 0, 内容: '変わりはありません' });

        await sql(
          `UPDATE customer c SET kana = NULLIF(u.k, ''), updated_at = now()
             FROM unnest($1::int[], $2::text[]) AS u(i, k)
            WHERE c.id = u.i`,
          [変わる.map((x) => x.id), 変わる.map((x) => x.よみ)]);
        // 誰のよみをどう変えたかは、1人ずつ残す。あとからたどれるように
        await sql(
          `INSERT INTO event (customer_id, recorded_by, kind, text)
           SELECT i, $1, '設定', t FROM unnest($2::int[], $3::text[]) AS u(i, t)`,
          [who, 変わる.map((x) => x.id),
           変わる.map((x) => `よみを「${今の[x.id].kana || '（空）'}」から「${x.よみ || '（空）'}」に変えた`)]);
        return ok(res, { done: true, 変えた人数: 変わる.length,
          内容: `よみを ${変わる.length}名ぶん入れた` });
      }

      const set = [], val = [], 説明 = [];
      for (const [key, col] of [['債権譲渡会社', 'assignor_id'], ['債権譲渡先', 'assignee_id']]) {
        if (b[key] === undefined) continue;
        if (b[key]) {
          const co = (await sql('SELECT id, name FROM company WHERE id=$1', [Number(b[key])]))[0];
          if (!co) return bad(res, `${key}が見つかりません。`, '設定で登録してください');
          val.push(co.id); set.push(`${col}=$${val.length}`);
          説明.push(`${key}を「${co.name}」に`);
        } else {
          set.push(`${col}=NULL`);
          説明.push(`${key}を空に`);
        }
      }
      if (!set.length) return bad(res, '変更する項目がありません。', '債権譲渡会社か債権譲渡先を指定してください');

      let where = 'archived = false';
      if (Array.isArray(b['対象'])) {
        const ids = b['対象'].map(Number).filter(Boolean);
        if (!ids.length) return bad(res, '対象の顧客が指定されていません。');
        val.push(ids);
        where += ` AND id = ANY($${val.length}::int[])`;
      }
      const done = await sql(
        `UPDATE customer SET ${set.join(', ')}, updated_at=now() WHERE ${where} RETURNING id`, val);
      if (done.length) {
        await sql(
          `INSERT INTO event (customer_id, recorded_by, kind, text)
           SELECT x, $1, '設定', $2 FROM unnest($3::int[]) AS t(x)`,
          [who, `まとめて変更：${説明.join('、')}した`, done.map((r) => r.id)]);
      }
      return ok(res, { done: true, 変えた人数: done.length, 内容: 説明.join('、') });
    }

    return bad(res, '対応していない操作です。');
  } catch (e) {
    fail(res, e, 'customers');
  }
};
