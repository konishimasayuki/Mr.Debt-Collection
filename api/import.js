// CSVの取り込み。
// POST /api/import {text}                  … 読み取ってプレビューを返す（保存しない）
// POST /api/import {実行:true, 明細:[...]}  … 画面で残した行だけを保存する
// POST /api/import {割当:{...}}             … 照合できなかった1件を顧客に割り当てる
//
// 照合・二重取込の判定・充当は api/_intake.js に置いてある。
// 銀行APIから来た明細も同じところを通る（2か所に書くと、いつか食い違うため）。
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, yen, normPayer, allocate } from './_lib.js';
import { parseCsv } from './_csv.js';
import { importKey, 照合の道具, 取込済みの鍵, プレビュー, 取り込む } from './_intake.js';

const bad = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  if ((req.method || '').toUpperCase() !== 'POST') {
    return bad(res, 405, { error: 'POSTで送ってください。' });
  }
  const who = recordedBy(req);

  try {
    const sql = db();
    const b = await readBody(req);

    // ── 照合できなかった1件を、人が選んだ顧客に割り当てる ──────
    if (b.割当) {
      const a = b.割当;
      const cid = Number(a.顧客id);
      const amount = Math.round(Number(a.金額) || 0);
      if (!cid) return bad(res, 400, { error: 'どの顧客かを選んでください。' });
      if (!amount || amount <= 0) return bad(res, 400, { error: '金額が読めません。' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.日付 || ''))) {
        return bad(res, 400, { error: '日付が読めません。' });
      }
      const c = (await sql('SELECT id, name FROM customer WHERE id=$1', [cid]))[0];
      if (!c) return bad(res, 400, { error: 'その顧客が見つかりません。' });

      // すでに入っている入金の付け替えか、新しく入れるか
      let pid = Number(a.入金id) || null;
      if (pid) {
        const p = (await sql('SELECT * FROM payment WHERE id=$1', [pid]))[0];
        if (!p) return bad(res, 400, { error: 'その入金が見つかりません。' });
        await sql('UPDATE payment SET customer_id=$1, updated_at=now() WHERE id=$2', [cid, pid]);
      } else {
        const key = String(a.鍵 || importKey(a, 1));
        const dup = await sql('SELECT id FROM payment WHERE import_key=$1', [key]);
        if (dup.length) return ok(res, { done: true, 保存した: false, 理由: 'すでに取り込み済みです' });
        pid = (await sql(
          `INSERT INTO payment (customer_id, paid_on, amount, method, source, ref_no,
                                payer_name, import_key, recorded_by)
           VALUES ($1,$2,$3,'振込','CSV',$4,$5,$6,$7) RETURNING id`,
          [cid, a.日付, amount, String(a.付番 || '') || null,
           String(a.振込人 || '') || null, key, who]))[0].id;
      }
      const r = await allocate(sql, cid, pid, amount);
      await sql(`INSERT INTO event (customer_id, payment_id, recorded_by, kind, text, memo)
                 VALUES ($1,$2,$3,'入金',$4,$5)`,
        [cid, pid, who, `${yen(amount)}円 を人が選んで割り当て（振込人：${a.振込人 || '—'}）`, null]);
      if (a.振込人) {
        await sql(`INSERT INTO payer_alias (normalized_name, customer_id, created_by)
                   VALUES ($1,$2,$3) ON CONFLICT (normalized_name) DO NOTHING`,
          [normPayer(a.振込人), cid, who]);
      }
      return ok(res, { done: true, 保存した: true, 顧客: c.name, 充当: r.充当, 余り: r.余り });
    }

    // ── 保存 ─────────────────────────────
    if (b.実行) {
      const rows = Array.isArray(b.明細) ? b.明細 : [];
      if (!rows.length) return bad(res, 400, { error: '取り込む行がありません。' });
      const r = await 取り込む(sql, who, rows, 'CSV');
      return ok(res, { done: true, 取り込んだ件数: r.取込, 見送った件数: r.見送り,
                       照合できなかった件数: r.未割当, 照合できなかった明細: r.残り });
    }

    // ── プレビュー（読み取るだけ。保存しない）──────────────
    if (!b.text) return bad(res, 400, { error: 'ファイルの中身がありません。' });
    let parsed;
    try { parsed = parseCsv(b.text); }
    catch (e) { return bad(res, 400, { error: 'CSVとして読み取れません。', 理由: e.message }); }

    const [{ customers, match, nameOf }, 済み] = await Promise.all([
      照合の道具(sql), 取込済みの鍵(sql),
    ]);
    const 明細 = プレビュー(parsed.明細, { match, nameOf, 済み });

    // 読めなかった行は、理由ごとにまとめて返す。
    // 明細は多くなりすぎないよう10件まで（出金の行は大量に出るため）。
    const 飛ばし = parsed.読み飛ばし || [];
    const 理由ごと = {};
    飛ばし.forEach((x) => (理由ごと[x.理由] = (理由ごと[x.理由] || 0) + 1));

    const sum = 明細.reduce((s, r) => s + r.金額, 0);
    return ok(res, {
      形式: parsed.形式,
      読み飛ばし: {
        件数: 飛ばし.length,
        内訳: Object.entries(理由ごと).map(([理由, 件数]) => ({ 理由, 件数 })),
        明細: 飛ばし.slice(0, 10),
      },
      概要: {
        件数: 明細.length,
        照合できた: 明細.filter((r) => r.照合できた).length,
        照合できない: 明細.filter((r) => !r.照合できた).length,
        ファイル内で重複: 明細.filter((r) => r.ファイル内で重複).length,
        すでに取込済み: 明細.filter((r) => r.すでに取込済み).length,
        合計: sum,
        ファイル検算: parsed.トレーラ ? parsed.トレーラ.合計 === sum : null,
      },
      明細,
      顧客: customers.map((c) => ({ id: c.id, 氏名: c.name, よみ: c.kana || '' })),
    });
  } catch (e) {
    fail(res, e, 'import');
  }
};
