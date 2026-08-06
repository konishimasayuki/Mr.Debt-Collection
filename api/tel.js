// 電話番号などを、名簿から貼り付けてまとめて入れる。
// POST /api/tel {text}              … 照合するだけ。保存しない
// POST /api/tel {実行:true, 明細:[]} … 画面で残した行だけを保存する
//
// 1件ずつ顧客ページを開いて打ち直すのは、54名では現実的でない。
// ただし「誰に何が入るか」を必ず見せてから入れる。取り違えると、
// 別の方に督促の電話をかけてしまう。
import { requireSession, recordedBy } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { readBody } from './_lib.js';

const bad = (res, msg, why) => {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(JSON.stringify(why ? { error: msg, 理由: why } : { error: msg }));
};

// 名簿の氏名をそろえる。名簿には敬称や記号が混ざる。
//   「中川和俊様」「熊上　　英加様」「志賀　楓"」「梅木光治藤田カナ）」
const 名を揃える = (s) => String(s == null ? '' : s)
  .normalize('NFKC')
  .replace(/[\s]/g, '')
  .replace(/(様|さま|サマ|さん|殿|どの)$/, '')
  .replace(/["'`”“’‘（）()「」『』\[\]【】]/g, '');

// 電話番号をそろえる。数字とハイフンだけ残す
const 番号を揃える = (s) => String(s == null ? '' : s)
  .normalize('NFKC').replace(/[^0-9-]/g, '');

// 貼り付けた文字を行に分ける。タブでも、2つ以上の空白でも区切れる
function 読み取る(text) {
  const out = [];
  String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => {
    const s = line.trim();
    if (!s) return;
    // タブ優先。無ければ「空白2つ以上」または「空白＋番号らしきもの」で切る
    let 名 = '', 番 = '';
    if (s.includes('\t')) {
      const f = s.split('\t');
      名 = f[0]; 番 = f.slice(1).join(' ');
    } else {
      const m = s.match(/^(.*?)[\s　]+([0-9０-９][0-9０-９\s　-]*)$/);
      if (m) { 名 = m[1]; 番 = m[2]; }
      else 名 = s;
    }
    out.push({ 行: i + 1, もとの名前: 名.trim(), もとの番号: (番 || '').trim() });
  });
  return out;
}

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  if ((req.method || '').toUpperCase() !== 'POST') {
    return bad(res, 'POSTで送ってください。');
  }

  try {
    const sql = db();
    const b = await readBody(req);
    const who = recordedBy(req);

    const 顧客 = await sql(
      `SELECT id, name, kana, tel FROM customer WHERE archived=false ORDER BY id`);

    // ── 保存 ──────────────────────────────
    if (b.実行) {
      const rows = Array.isArray(b.明細) ? b.明細 : [];
      const 入れる = rows.filter((r) => r.顧客id && r.電話番号);
      if (!入れる.length) return bad(res, '入れる行がありません。');

      const ids = 入れる.map((r) => Number(r.顧客id));
      const tels = 入れる.map((r) => 番号を揃える(r.電話番号));
      await sql(
        `UPDATE customer c SET tel = u.t, updated_at = now()
           FROM unnest($1::int[], $2::text[]) AS u(i, t)
          WHERE c.id = u.i`, [ids, tels]);
      await sql(
        `INSERT INTO event (customer_id, recorded_by, kind, text)
         SELECT u.i, $1, '設定', '電話番号を名簿からまとめて入れた：' || u.t
           FROM unnest($2::int[], $3::text[]) AS u(i, t)`, [who, ids, tels]);

      return ok(res, { done: true, 入れた件数: 入れる.length });
    }

    // ── 照合するだけ ────────────────────────
    if (!b.text) return bad(res, '貼り付けた中身がありません。');
    const 明細 = 読み取る(b.text);
    if (!明細.length) return bad(res, '読み取れる行がありませんでした。');

    // 顧客も同じ形にそろえてから当てる
    const 索引 = {};
    顧客.forEach((c) => {
      const k = 名を揃える(c.name);
      (索引[k] = 索引[k] || []).push(c);
    });

    let 当たり = 0, 外れ = 0, 番号なし = 0;
    const 結果 = 明細.map((r) => {
      const 番号 = 番号を揃える(r.もとの番号);
      const k = 名を揃える(r.もとの名前);
      const 候補 = 索引[k] || [];
      if (!番号) 番号なし++;
      if (候補.length === 1) 当たり++;
      else 外れ++;
      const c = 候補.length === 1 ? 候補[0] : null;
      return {
        行: r.行, もとの名前: r.もとの名前, 電話番号: 番号,
        顧客id: c ? c.id : null, 顧客名: c ? c.name : null,
        いまの番号: c ? (c.tel || '') : '',
        判断: !番号 ? '電話番号が読み取れません'
          : 候補.length === 1 ? (c.tel ? `いまの番号（${c.tel}）を書き換えます` : '入ります')
          : 候補.length > 1 ? '同じお名前が複数います。確かめてください'
          : '台帳に見つかりません',
        当たった: 候補.length === 1 && !!番号,
      };
    });

    return ok(res, {
      概要: { 件数: 結果.length, 当たった: 結果.filter((r) => r.当たった).length,
        当たらない: 結果.filter((r) => !r.当たった).length,
        書き換え: 結果.filter((r) => r.当たった && r.いまの番号).length },
      明細: 結果,
      顧客: 顧客.map((c) => ({ id: c.id, 氏名: c.name, よみ: c.kana || '', 電話番号: c.tel || '' })),
      // 名簿に出てこなかった顧客。入れ忘れに気づけるようにする
      名簿に無い顧客: 顧客
        .filter((c) => !結果.some((r) => r.顧客id === c.id))
        .map((c) => c.name),
    });
  } catch (e) {
    fail(res, e, 'tel');
  }
};
