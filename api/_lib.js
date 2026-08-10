// サーバー側の共通処理。

// ── 検索・名寄せの正規化 ───────────────────────
// 「かな」「全角カナ」「半角カナ」「半角英字」「全角英字」のどれで打っても
// 同じ人に当たるようにする。
//   NFKC で 半角カナ→全角カナ、全角英数→半角英数 が揃う。
//   そのうえで ひらがな→カタカナ、英字は小文字へ、空白と記号を落とす。
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s　]/g, '')
    .replace(/[()（）.,･・ー\-‐―－]/g, '')
    .toLowerCase();
}

// 振込人名の正規化。上に加えて法人格を落とす
// 「よみ」を全角カタカナにそろえる。
// ひらがなで打っても、半角カナで打っても、同じ形にして保存する。
// 保存の形がばらつくと、並び順も照合も当てにならなくなる。
function カナにそろえる(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')                                   // 半角カナ・英数を全角の形へ
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))  // ひらがな→カタカナ
    .replace(/[\s　]+/g, ' ')
    .trim();
}
// よみとして受け付けられるか。カタカナ・長音・中黒・空白だけ。
// 漢字や英字が混じっていたら、それは「よみ」ではないので断る
const よみか = (s) => /^[ァ-ヶー・\s]*$/.test(カナにそろえる(s));

function normPayer(s) {
  return norm(String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/株式会社|有限会社|\(株\)|\(有\)|カブシキガイシャ/g, '')
    .replace(/^カ\)|カ\)$/g, ''));
}

// ── 日付 ──────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const isoOf = (v) => (v == null ? null : iso(new Date(v)));
const today = () => new Date().toISOString().slice(0, 10);

// その月の末日
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// 回次kの支払期日。その月に支払日が無ければ末日にする(2月31日→2月28日)
function dueOf(y0, m0, day, k) {
  const t = y0 * 12 + (m0 - 1) + (k - 1);
  const y = Math.floor(t / 12), m = (t % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(day, lastDay(y, m)))}`;
}

const yen = (n) => Number(n || 0).toLocaleString('ja-JP');

// 支払予定を回数ぶん、1回のINSERTで作る。
// 1件ずつ入れると回数ぶん往復するので、ネットワーク越しでは目に見えて遅くなる。
async function makeSchedule(sql, customerId, y0, m0, payDay, term, monthly) {
  const vals = [], args = [];
  for (let k = 1; k <= term; k++) {
    args.push(customerId, k, dueOf(y0, m0, payDay, k), monthly);
    const i = args.length;
    vals.push(`($${i - 3},$${i - 2},'通常',$${i - 1},$${i})`);
  }
  await sql(
    `INSERT INTO schedule (customer_id, no, kind, due_date, planned_amount)
     VALUES ${vals.join(',')} ON CONFLICT (customer_id, kind, no) DO NOTHING`, args);
  return term;
}

// ── ボーナス払い ────────────────────────────
// 「7月と12月の10日に◯円」のように、月を複数選んで足す。
// 通常の回とは別に数える（画面では「全48回 + ボーナス4回」と出す）。
// 予定は同じ schedule に入れるので、充当も残債もそのまま動く。

// 契約の期間に入るボーナスの期日を、古い順に出す。
// 初回の期日から最終回の期日までのあいだにある月だけを拾う。
function bonusDues(y0, m0, payDay, term, months, day) {
  const 月 = [...new Set((months || []).map(Number).filter((m) => m >= 1 && m <= 12))]
    .sort((a, b) => a - b);
  if (!月.length || !day) return [];
  const 初回 = dueOf(y0, m0, payDay, 1);
  const 最終 = dueOf(y0, m0, payDay, term);
  const out = [];
  const 始 = y0 * 12 + (m0 - 1);
  const 終 = 始 + (term - 1);
  for (let t = 始; t <= 終; t++) {
    const y = Math.floor(t / 12), m = (t % 12) + 1;
    if (!月.includes(m)) continue;
    const d = `${y}-${pad(m)}-${pad(Math.min(day, lastDay(y, m)))}`;
    // 契約の外に出る日は入れない（初回より前・最終回より後）
    if (d < 初回 || d > 最終) continue;
    out.push(d);
  }
  return out;
}

// ボーナスの支払予定を作り直す。
// **入金が充てられている回は触らない。** 消すと入金の行き先が消えるため。
// 返すのは {足した, 消した, 直した}。
async function remakeBonus(sql, customerId, y0, m0, payDay, term, months, day, amount) {
  const 今 = await sql(
    `SELECT s.id, s.no, s.due_date, s.planned_amount,
            COALESCE((SELECT sum(a.amount) FROM allocation a
                       WHERE a.schedule_id = s.id),0)::int AS paid
       FROM schedule s
      WHERE s.customer_id=$1 AND s.kind='ボーナス'
      ORDER BY s.no`, [customerId]);

  const 欲しい = (months && months.length && day && amount)
    ? bonusDues(y0, m0, payDay, term, months, day) : [];

  // 入金のある回は残す。残りは作り直す
  const 残す = 今.filter((s) => s.paid > 0);
  const 消す = 今.filter((s) => s.paid <= 0);
  const 残す日 = new Set(残す.map((s) => isoOf(s.due_date)));

  if (消す.length) {
    await sql('DELETE FROM schedule WHERE id = ANY($1::int[])', [消す.map((s) => s.id)]);
  }

  // 期日の順に番号を振り直す。入金のある回はそのまま活かす
  const 全部 = [...new Set([...残す日, ...欲しい])].sort();
  const 足す = [], 引数 = [], 値 = [];
  全部.forEach((d, i) => {
    const 既 = 残す.find((s) => isoOf(s.due_date) === d);
    if (既) return;                    // 入金がある回はいじらない
    足す.push({ no: i + 1, due: d });
  });
  // 番号は最後にまとめて振り直す（入金のある回も含めて期日順）
  for (const s of 残す) {
    const i = 全部.indexOf(isoOf(s.due_date));
    if (i >= 0 && s.no !== i + 1) {
      await sql('UPDATE schedule SET no=$1 WHERE id=$2', [i + 1, s.id]);
    }
  }
  足す.forEach((x) => {
    引数.push(customerId, x.no, x.due, amount);
    const i = 引数.length;
    値.push(`($${i - 3},$${i - 2},'ボーナス',$${i - 1},$${i})`);
  });
  if (値.length) {
    await sql(`INSERT INTO schedule (customer_id, no, kind, due_date, planned_amount)
               VALUES ${値.join(',')}`, 引数);
  }
  return { 足した: 足す.length, 消した: 消す.length, 全体: 全部.length,
    入金があって残した: 残す.length };
}

// ── 本文の読み取り ─────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    // 本文の無い DELETE などは、読み取る相手がいない
    if (typeof req.on !== 'function') return resolve({});
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 2e7) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// URL のクエリ
function query(req) {
  const q = {};
  const s = String(req.url || '');
  const i = s.indexOf('?');
  if (i < 0) return q;
  new URLSearchParams(s.slice(i + 1)).forEach((v, k) => (q[k] = v));
  return q;
}

// ── 充当まわり ────────────────────────────
// データベースは遠くにあり、問い合わせ1回ごとに往復の待ち時間がかかる。
// 回ごとに1回ずつ聞くと、48回の契約では往復が48倍になって目に見えて遅くなる。
// そのため、ここでは「回数によらず決まった数の問い合わせ」で済むように書く。

// 指定した回の状態を、いま入っている額から決め直す。何回ぶんでも1回で済ませる
async function restateMany(sql, ids) {
  if (!ids || !ids.length) return;
  await sql(
    `UPDATE schedule s SET state = CASE
          WHEN p.n <= 0                  THEN '未入金'
          WHEN p.n >= s.planned_amount   THEN '入金済み'
          ELSE '一部入金' END
       FROM (SELECT t.x AS id,
                    COALESCE((SELECT sum(a.amount) FROM allocation a
                               WHERE a.schedule_id = t.x),0)::int AS n
               FROM unnest($1::int[]) AS t(x)) p
      WHERE s.id = p.id`, [ids]);
}
// 入金種類。画面では「月額」と呼んでいるが、支払予定の kind は '通常'。
// 打ち間違いを1か所で受け止める。知らない言葉なら null（種類を決めずに充てる）。
const 入金種類 = (v) => {
  const t = String(v == null ? '' : v).trim();
  if (t === '月額' || t === '通常') return '通常';
  if (t === 'ボーナス' || t === '賞与') return 'ボーナス';
  return null;
};

// 入金を、未入金でいちばん古い回から順に充てる。
// 満額に届いた回だけ「入金済み」にし、途中は「一部入金」のまま残りを持つ。
// 予定を使い切ってもお金が余ったら、充当せずに余りとして返す(前受)。
//
// 種類（'通常' か 'ボーナス'）を渡すと、その種類の回にだけ充てる。
// 渡さないと期日の古い順に種類を問わず埋めるので、
// ボーナスのつもりで入れた大きな入金が、古い月額の回に食われてしまう。
async function allocate(sql, customerId, paymentId, amount, 種類) {
  let left = amount;
  const touched = [];
  const 絞る = 入金種類(種類);
  // 各回の「すでに入っている額」も一緒に持ってくる(回ごとに聞き直さない)
  const rows = await sql(
    `SELECT s.id, s.no, s.kind, s.planned_amount,
            COALESCE((SELECT sum(a.amount) FROM allocation a
                       WHERE a.schedule_id = s.id),0)::int AS paid
       FROM schedule s
      WHERE s.customer_id=$1 AND s.state <> '入金済み'
        ${絞る ? "AND COALESCE(s.kind,'通常') = $2" : ''}
      ORDER BY s.due_date, s.kind, s.no`,
    絞る ? [customerId, 絞る] : [customerId]);

  const 値 = [], 引数 = [], 済み = [], 一部 = [];
  for (const s of rows) {
    if (left <= 0) break;
    const rest = s.planned_amount - s.paid;
    if (rest <= 0) continue;
    const take = Math.min(left, rest);
    引数.push(paymentId, s.id, take);
    const i = 引数.length;
    値.push(`($${i - 2},$${i - 1},$${i})`);
    (take >= rest ? 済み : 一部).push(s.id);
    touched.push({ no: s.no, 種類: s.kind, 充てた: take, 残り: rest - take });
    left -= take;
  }
  if (値.length) {
    await sql(`INSERT INTO allocation (payment_id, schedule_id, amount)
               VALUES ${値.join(',')}`, 引数);
    // 状態は2種類しかないので、まとめて2回で足りる
    if (済み.length) {
      await sql(`UPDATE schedule SET state='入金済み' WHERE id = ANY($1::int[])`, [済み]);
    }
    if (一部.length) {
      await sql(`UPDATE schedule SET state='一部入金' WHERE id = ANY($1::int[])`, [一部]);
    }
  }
  return { 充当: touched, 余り: left };
}

// 入金を取り消す。充当を消して、触っていた回の状態を戻す
async function unallocate(sql, paymentId) {
  const rows = await sql(
    `SELECT DISTINCT schedule_id FROM allocation
      WHERE payment_id=$1 AND schedule_id IS NOT NULL`, [paymentId]);
  await sql(`DELETE FROM allocation WHERE payment_id=$1`, [paymentId]);
  await restateMany(sql, rows.map((r) => r.schedule_id));
}

// ── 顧客の今の状況(一覧・未入金で使う)─────────────
// 残り回数・残債・次の期日・遅れているか
function summarize(cust, rows, paidBy) {
  const term = cust.term_count;
  // 通常とボーナスは別に数える。「全48回 + ボーナス4回」と出すため
  const 通常 = rows.filter((s) => (s.kind || '通常') === '通常');
  const ボ = rows.filter((s) => s.kind === 'ボーナス');
  const done = 通常.filter((s) => s.state === '入金済み').length;
  const 入金合計 = rows.reduce((a, s) => a + (paidBy[s.id] || 0), 0);
  // 追いかけるのは、期日がいちばん早い未済の回。ボーナスも同じ列に並ぶ
  const 未済 = rows.filter((s) => s.state !== '入金済み')
    .sort((a, b) => String(isoOf(a.due_date)).localeCompare(String(isoOf(b.due_date))));
  const cur = 未済[0] || null;
  const 期日 = cur ? isoOf(cur.due_date) : null;
  const t = today();
  return {
    残り回数: term - done,
    支払い回数: done,
    ボーナス回数: ボ.length,
    ボーナス残り: ボ.filter((s) => s.state !== '入金済み').length,
    ボーナス総額: ボ.reduce((a, s) => a + s.planned_amount, 0),
    // いま追いかけている回がボーナスかどうか。未入金タブで印を出す
    ボーナス中: !!(cur && cur.kind === 'ボーナス'),
    残債: Math.max(0, cust.total_amount - 入金合計),
    入金合計,
    次の期日: 期日,
    回次: cur ? cur.no : term,
    回の種類: cur ? (cur.kind || '通常') : '通常',
    この回の請求: cur ? cur.planned_amount : 0,
    この回の入金: cur ? (paidBy[cur.id] || 0) : 0,
    この回の残り: cur ? Math.max(0, cur.planned_amount - (paidBy[cur.id] || 0)) : 0,
    遅れ: !!(期日 && 期日 < t),
    遅れ日数: 期日 && 期日 < t
      ? Math.round((new Date(t) - new Date(期日)) / 86400000) : 0,
    完済: !cur,
  };
}

export {
  norm, normPayer, カナにそろえる, よみか, pad, iso, isoOf, today, lastDay, dueOf, yen,
  readBody, query, restateMany, allocate, unallocate, summarize, makeSchedule,
  bonusDues, remakeBonus, 入金種類,
};
