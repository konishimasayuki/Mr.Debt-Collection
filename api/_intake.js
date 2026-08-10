// 入金の取り込み。CSVからでも銀行APIからでも、ここを通す。
//
// 明細の形はどちらも同じ:  {日付, 付番, 金額, 振込人}
// 振込人名から顧客を当てる・二重取込を弾く・古い回から充てる、は
// どこから来た明細でも同じでなければならない。
// 2か所に書くと、いつか片方だけ直されて食い違う。だから1か所に置く。
import { isoOf, yen, normPayer, allocate } from './_lib.js';
import { あいうえお順 } from './_yomi_dict.js';

// 重複判定の鍵。日付+付番+金額
const dupKey = (r) => `${r.日付}|${String(r.付番 || '').trim()}|${r.金額}`;
// 二重取込を弾く鍵。付番が無い/重複しうるので、同一内の連番も混ぜる
const importKey = (r, seq) => `${r.日付}|${String(r.付番 || '').trim()}|${r.金額}|${normPayer(r.振込人)}|${seq}`;

// 自動で取り込んだ入金の区分。手で入れたものとは分けて数える
const 自動の区分 = ['CSV', '銀行'];

// 振込人名から顧客を当てる
function matcher(aliases, customers) {
  const byAlias = {};
  aliases.forEach((a) => (byAlias[a.normalized_name] = a.customer_id));
  const byKana = {};
  customers.forEach((c) => {
    const k = normPayer(c.kana || '');
    if (k) (byKana[k] = byKana[k] || []).push(c);
    const n = normPayer(c.name || '');
    if (n && n !== k) (byKana[n] = byKana[n] || []).push(c);
  });
  const keys = Object.keys(byKana).filter((k) => k.length >= 2)
    .sort((a, b) => b.length - a.length);      // 長い読みを先に見る

  return (payer, amount) => {
    const k = normPayer(payer);
    if (!k) return { id: null, 理由: '振込人名がありません' };
    if (byAlias[k]) return { id: byAlias[k], 理由: '前に紐付けたお名前' };
    let cand = byKana[k], why = 'お名前が一致';
    if (!cand) {
      const hit = keys.find((key) => k.startsWith(key));
      if (hit) { cand = byKana[hit]; why = `苗字の読み「${hit}」で一致`; }
    }
    if (!cand || !cand.length) return { id: null, 理由: '該当する顧客が見つかりません' };
    if (cand.length === 1) return { id: cand[0].id, 理由: why };
    const fit = cand.filter((c) => c.monthly_amount === amount);
    if (fit.length === 1) return { id: fit[0].id, 理由: `${why}。同姓のため金額で判断` };
    return { id: null, 理由: '同じお名前が複数います。確かめてください' };
  };
}

// 照合に使う道具を一度に用意する。顧客と名寄せ辞書は同時に取ってくる
async function 照合の道具(sql) {
  const [customers, aliases] = await Promise.all([
    sql(`SELECT id, name, kana, monthly_amount FROM customer WHERE archived=false ORDER BY id`),
    sql(`SELECT normalized_name, customer_id FROM payer_alias`),
  ]);
  // 顧客を選ぶ欄に出すので、あいうえお順にそろえる。
  // 顧客一覧と並びが違うと、同じ人を探すのに二度手間になる
  customers.sort(あいうえお順);
  const match = matcher(aliases, customers);
  const nameOf = (id) => (customers.find((c) => c.id === id) || {}).name || null;
  return { customers, match, nameOf };
}

// すでに取り込んである明細（日付+付番+金額 で見る）。
// CSVと銀行の両方を見る。同じ入金がCSVと銀行の両方から来ることがあるため
async function 取込済みの鍵(sql) {
  const done = await sql(
    `SELECT paid_on, ref_no, amount FROM payment WHERE source = ANY($1::text[])`,
    [自動の区分]);
  return new Set(done.map((d) =>
    `${isoOf(d.paid_on)}|${String(d.ref_no || '').trim()}|${d.amount}`));
}

// 確認画面に出す形にする。保存はしない。
// 「重複」は同じ取り込みの中にある重なり。「すでに取込済み」は前に入れたもの。
// 印を付けるだけで勝手には落とさない（同じ日に同じ額が2件、は実際に起きるため）。
function プレビュー(明細, { match, nameOf, 済み }) {
  const count = {};
  明細.forEach((r) => { const k = dupKey(r); count[k] = (count[k] || 0) + 1; });
  const seq = {};
  return 明細.map((r, i) => {
    const k = dupKey(r);
    seq[k] = (seq[k] || 0) + 1;
    const m = match(r.振込人, r.金額);
    return {
      行: i + 1, 鍵: r.鍵 || importKey(r, seq[k]),
      日付: r.日付, 付番: r.付番 || '', 金額: r.金額, 振込人: r.振込人 || '',
      顧客id: m.id, 顧客名: nameOf(m.id), 判断: m.理由,
      照合できた: !!m.id,
      ファイル内で重複: count[k] > 1,
      すでに取込済み: 済み.has(k),
    };
  });
}

// 人が確かめて残した行を、入金として保存する。
// 区分は 'CSV' か '銀行'。画面で行の色を変えるためと、あとから出所をたどるため。
async function 取り込む(sql, who, rows, 区分 = 'CSV') {
  const { match } = await 照合の道具(sql);
  let 取込 = 0, 見送り = 0, 未割当 = 0;
  const 残り = [];

  // 読み取れる行に絞り、二重取込の鍵を作る
  const seen = {};
  const 有効 = [];
  for (const r of rows) {
    const amount = Math.round(Number(r.金額) || 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.日付 || '')) || !amount || amount <= 0) {
      見送り++; continue;
    }
    const base = dupKey(r);
    seen[base] = (seen[base] || 0) + 1;
    有効.push({ r, amount, key: String(r.鍵 || importKey(r, seen[base])) });
  }

  // 取り込み済みかどうかは、1行ずつ聞かずにまとめて1回で聞く。
  // データベースは遠くにあり、問い合わせ1回ごとに往復の待ち時間がかかる。
  // 100行のCSVなら、それだけで往復が100回ぶん積み上がる。
  const 済み = new Set();
  if (有効.length) {
    const d = await sql('SELECT import_key FROM payment WHERE import_key = ANY($1::text[])',
      [有効.map((x) => x.key)]);
    d.forEach((x) => 済み.add(x.import_key));
  }
  // 鍵が同じ行は1件にまとめる。まとめて入れるので、
  // 1行でも鍵がぶつかると全部が入らなくなってしまう。
  const 入れる = 有効.filter((x) => {
    if (済み.has(x.key)) { 見送り++; return false; }
    済み.add(x.key);
    return true;
  });

  // 入金の登録もまとめて1回。付いたIDは並び順で受け取る
  let 入金 = [];
  if (入れる.length) {
    const 値 = [], 引数 = [];
    入れる.forEach((x) => {
      const cid = x.r.顧客id ? Number(x.r.顧客id) : match(x.r.振込人, x.amount).id;
      x.cid = cid || null;
      引数.push(x.cid, x.r.日付, x.amount, 区分, String(x.r.付番 || '') || null,
               String(x.r.振込人 || '') || null, x.key, who);
      const i = 引数.length;
      値.push(`($${i - 7},$${i - 6},$${i - 5},'振込',$${i - 4},$${i - 3},$${i - 2},$${i - 1},$${i})`);
    });
    入金 = await sql(
      `INSERT INTO payment (customer_id, paid_on, amount, method, source, ref_no,
                            payer_name, import_key, recorded_by)
       VALUES ${値.join(',')} RETURNING id, import_key`, 引数);
  }
  const idOf = {};
  入金.forEach((p) => (idOf[p.import_key] = p.id));

  // 充当は同じ顧客の中では順番が要る（古い回から埋める）。
  // 別の顧客どうしは関係がないので、顧客ごとにまとめて同時に進める。
  // 50行を1件ずつ待つと、待ち時間が50回ぶん積み上がる。
  const 顧客ごと = new Map();
  const 入れた = [];
  for (const x of 入れる) {
    const pid = idOf[x.key];
    if (!pid) { 見送り++; continue; }
    x.pid = pid;
    入れた.push({ 鍵: x.key, 入金id: pid });
    if (!x.cid) {
      未割当++;
      残り.push({ 入金id: pid, 日付: x.r.日付, 付番: x.r.付番 || '', 金額: x.amount,
                  振込人: x.r.振込人 || '', 理由: match(x.r.振込人, x.amount).理由 });
      continue;
    }
    if (!顧客ごと.has(x.cid)) 顧客ごと.set(x.cid, []);
    顧客ごと.get(x.cid).push(x);
    取込++;
  }

  const 記録 = [];
  await Promise.all([...顧客ごと.values()].map(async (組) => {
    for (const x of 組) {
      const al = await allocate(sql, x.cid, x.pid, x.amount);
      記録.push([x.cid, x.pid,
        `${区分}から ${yen(x.amount)}円 を取り込み（${x.r.日付}・振込人：${x.r.振込人 || '—'}）`
        + (al.余り ? `。余り ${yen(al.余り)}円` : ''),
        normPayer(x.r.振込人)]);
    }
  }));

  // 記録と名寄せ辞書も、それぞれ1回にまとめる
  if (記録.length) {
    await Promise.all([
      sql(`INSERT INTO event (customer_id, payment_id, recorded_by, kind, text)
           SELECT c, p, $1, '入金', t
             FROM unnest($2::int[], $3::int[], $4::text[]) AS u(c, p, t)`,
        [who, 記録.map((x) => x[0]), 記録.map((x) => x[1]), 記録.map((x) => x[2])]),
      sql(`INSERT INTO payer_alias (normalized_name, customer_id, created_by)
           SELECT n, c, $1 FROM unnest($2::text[], $3::int[]) AS u(n, c)
            WHERE n <> ''
           ON CONFLICT (normalized_name) DO NOTHING`,
        [who, 記録.map((x) => x[3]), 記録.map((x) => x[0])]),
    ]);
  }

  return { 取込, 見送り, 未割当, 残り, 入れた };
}

export { dupKey, importKey, matcher, 照合の道具, 取込済みの鍵, プレビュー, 取り込む, 自動の区分 };
