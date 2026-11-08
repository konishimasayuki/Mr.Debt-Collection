// CSVの取り込み。
// POST /api/import {text}                  … 読み取ってプレビューを返す（保存しない）
// POST /api/import {実行:true, 明細:[...]}  … 画面で残した行だけを保存する
// POST /api/import {割当:{...}}             … 照合できなかった1件を顧客に割り当てる
// GET  /api/import                         … 取り込んだCSVの原本の一覧
// GET  /api/import?id=N                    … その原本そのもの（落とす）
//
// 照合・二重取込の判定・充当は api/_intake.js に置いてある。
// 銀行APIから来た明細も同じところを通る（2か所に書くと、いつか食い違うため）。
import { createHash } from 'node:crypto';
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody, query, yen, normPayer, allocate, 詰め直す, 入金種類 } from './_lib.js';
import { parseCsv } from './_csv.js';
import { importKey, 照合の道具, 取込済みの鍵, プレビュー, 取り込む } from './_intake.js';

const bad = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

// 原本の大きさの上限。銀行のCSVは大きくても数百KB。
// 桁が違うものが来たら、CSVではないので断る
const 上限 = 10 * 1024 * 1024;

// 取り込んだCSVの原本を置く。
//
// **文字を直さず、銀行が作ったバイトのまま入れる。**
// 画面では Shift_JIS を UTF-8 に直して読んでいるが、直したものは原本ではない。
// 落とし直したときに、銀行の出力と1バイトも違わないようにする。
//
// 同じ中身のファイルは二度置かない（指紋で見分ける）。
// 同じCSVをもう一度取り込んでも、置き場が増えていかない。
async function 原本を置く(sql, who, 原本) {
  if (!原本 || !原本.中身) return null;
  let bytes;
  try { bytes = Buffer.from(String(原本.中身), 'base64'); }
  catch { return null; }
  if (!bytes.length) return null;
  if (bytes.length > 上限) {
    const e = new Error('ファイルが大きすぎます。');
    e.断る = true;
    throw e;
  }
  const 指紋 = createHash('sha256').update(bytes).digest('hex');
  const 名 = String(原本.名前 || '').trim().slice(0, 200) || null;

  const 既 = await sql('SELECT id FROM import_file WHERE sha256=$1', [指紋]);
  if (既.length) return 既[0].id;
  const r = await sql(
    `INSERT INTO import_file (name, bytes, size, sha256, uploaded_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [名, bytes, bytes.length, 指紋, who]);
  return r[0].id;
}

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  const method = (req.method || '').toUpperCase();
  const who = recordedBy(req);

  try {
    const sql = db();

    // ── 取り込んだCSVの原本を見る・落とす ──────────────
    if (method === 'GET') {
      const id = Number(query(req).id) || 0;
      if (id) {
        const f = (await sql(
          'SELECT name, bytes, size FROM import_file WHERE id=$1', [id]))[0];
        if (!f) return bad(res, 404, { error: 'そのファイルが見つかりません。' });
        // 中身は銀行が作ったまま。文字の種類は決め打ちしない
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Length', String(f.size));
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(f.name || `csv-${id}.csv`)}`);
        return res.end(Buffer.from(f.bytes));
      }
      const 一覧 = await sql(
        `SELECT f.id, f.name, f.size, f.sha256, f.rows_in, f.uploaded_by,
                to_char(f.created_at AT TIME ZONE 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') AS at,
                COALESCE((SELECT count(*) FROM payment p
                           WHERE p.import_file_id = f.id),0)::int AS 残っている入金
           FROM import_file f ORDER BY f.id DESC LIMIT 200`);
      return ok(res, {
        ファイル: 一覧.map((f) => ({
          id: f.id, 名前: f.name || '（名前なし）', 大きさ: f.size,
          指紋: f.sha256.slice(0, 12), 取り込んだ件数: f.rows_in,
          いま残っている入金: f.残っている入金,
          取り込んだ人: f.uploaded_by, 取り込んだ日時: f.at,
        })),
      });
    }

    if (method !== 'POST') {
      return bad(res, 405, { error: '対応していない操作です。' });
    }
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
                                payer_name, import_key, alloc_kind, recorded_by)
           VALUES ($1,$2,$3,'振込','CSV',$4,$5,$6,$7,$8) RETURNING id`,
          [cid, a.日付, amount, String(a.付番 || '') || null,
           String(a.振込人 || '') || null, key, 入金種類(a.入金種類) || '通常', who]))[0].id;
      }
      // どの回に充てるかは人が選ぶ。何も選ばれていなければ月額（通常）
      const 種類 = 入金種類(a.入金種類) || '通常';
      await sql('UPDATE payment SET alloc_kind=$1 WHERE id=$2', [種類, pid]);
      const r = await allocate(sql, cid, pid, amount, 種類);
      // 付け替えた入金だけを充てると、ほかの入金が前の回に残る。まるごと詰め直す
      const 余り = await 詰め直す(sql, cid);
      r.余り = 余り[pid] || 0;
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
      // 原本は、取り込むときにだけ置く。
      // 確認のたびに置くと、見ただけで取り込まなかったファイルまで溜まる
      let ファイルid = null;
      try { ファイルid = await 原本を置く(sql, who, b.原本); }
      catch (e) { if (e.断る) return bad(res, 400, { error: e.message }); throw e; }
      const r = await 取り込む(sql, who, rows, 'CSV', ファイルid);
      if (ファイルid) {
        // このファイルから入った入金の数。顧客に当てられなかった行も入金として
        // 入るので、両方を足す（「何件このファイルから来たか」が知りたい）
        await sql('UPDATE import_file SET rows_in=$1 WHERE id=$2',
          [r.取込 + r.未割当, ファイルid]);
      }
      return ok(res, { done: true, 取り込んだ件数: r.取込, 見送った件数: r.見送り,
                       照合できなかった件数: r.未割当, 照合できなかった明細: r.残り,
                       除いた件数: r.除いた, 余った: r.余った,
                       原本を残した: !!ファイルid });
    }

    // ── プレビュー（読み取るだけ。保存しない）──────────────
    if (!b.text) return bad(res, 400, { error: 'ファイルの中身がありません。' });
    let parsed;
    try { parsed = parseCsv(b.text); }
    catch (e) { return bad(res, 400, { error: 'CSVとして読み取れません。', 理由: e.message }); }

    const [{ customers, match, nameOf, 除外 }, 済み] = await Promise.all([
      照合の道具(sql), 取込済みの鍵(sql),
    ]);
    const 全部 = プレビュー(parsed.明細, { match, nameOf, 済み, 除外 });
    // 取り込まないと決めた振込人は、表に出さない。
    // 毎回チェックを外す手間と、外し忘れをなくすため
    const 明細 = 全部.filter((r) => !r.除外された);
    const 除いた行 = 全部.filter((r) => r.除外された);

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
      // 除外リストで外した行。何を外したかは必ず見せる（黙って落とさない）
      除いた: {
        件数: 除いた行.length,
        振込人: [...new Set(除いた行.map((r) => r.振込人))].filter(Boolean),
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
      顧客: customers.map((c) => ({
        id: c.id, 氏名: c.name, よみ: c.kana || '',
        月額: c.monthly_amount,
        // ボーナス払いの設定がある方だけ、確認画面で「ボーナス」を選べる
        ボーナス金額: (c.bonus_months && c.bonus_months.length && c.bonus_amount)
          ? c.bonus_amount : null,
        // いま払えていない回の種類。入金種類の既定に使う
        追う回の種類: c.追う回の種類 || '通常',
        // まだ払っていないボーナスの回の残り。0なら「ボーナスにも」は出さない
        ボーナス未払い額: c.ボーナス未払い額 || 0,
      })),
    });
  } catch (e) {
    fail(res, e, 'import');
  }
};
