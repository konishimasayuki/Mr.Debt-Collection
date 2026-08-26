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
//
// 開始（'YYYY-MM-DD'）を渡すと、その日より前は作らない。
// 契約の途中から賞与を入れる方がいるため。渡さなければ契約の初回から。
//
// 回数を渡すと、古いほうからその回数ぶんだけにする。
// 「7月と12月だが、賞与は6回ぶんだけ」という契約があるため。
function bonusDues(y0, m0, payDay, term, months, day, 開始, 回数) {
  const 月 = [...new Set((months || []).map(Number).filter((m) => m >= 1 && m <= 12))]
    .sort((a, b) => a - b);
  if (!月.length || !day) return [];
  const 初回 = 開始 && 開始 > dueOf(y0, m0, payDay, 1) ? 開始 : dueOf(y0, m0, payDay, 1);
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
  const n = Number(回数) || 0;
  return n > 0 ? out.slice(0, n) : out;
}

// ボーナスの支払予定を作り直す。
// **入金が充てられている回は触らない。** 消すと入金の行き先が消えるため。
// 返すのは {足した, 消した, 直した}。
async function remakeBonus(sql, customerId, y0, m0, payDay, term, months, day, amount,
                           開始, 回数) {
  const 今 = await sql(
    `SELECT s.id, s.no, s.due_date, s.planned_amount,
            COALESCE((SELECT sum(a.amount) FROM allocation a
                       WHERE a.schedule_id = s.id),0)::int AS paid
       FROM schedule s
      WHERE s.customer_id=$1 AND s.kind='ボーナス'
      ORDER BY s.no`, [customerId]);

  const 欲しい = (months && months.length && day && amount)
    ? bonusDues(y0, m0, payDay, term, months, day, 開始, 回数) : [];

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
  // 月々のぶんと賞与のぶんを、まとめて1回で振り込む方がいる。
  // その1件を、ボーナスの回1回ぶんと、残りの月額の回へ分けて充てる。
  if (t === '月額＋ボーナス' || t === '月額+ボーナス' || t === '両方') return '両方';
  return null;
};

// 充てる先の回を、種類のきまりに沿って選び出す。
// '両方' は、いちばん古い未払いのボーナスの回を1回だけ先に置き、
// そのあとに月額の回を古い順に並べる。
// ボーナスを先にするのは、人が「ボーナスにも割り当てる」と決めたのだから、
// 月額の回に食われてボーナスが埋まらないのでは意味がないため。
// 1回だけにするのは、1度の振り込みで賞与2回ぶんを払うことは無いから。
function 充てる順(rows, 絞る) {
  if (絞る !== '両方') return rows.filter((s) => (s.kind || '通常') === 絞る);
  const ボ = rows.filter((s) => s.kind === 'ボーナス');
  const 月 = rows.filter((s) => (s.kind || '通常') === '通常');
  return ボ.length ? [ボ[0], ...月] : 月;
}

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
  // 種類が決まっていない入金は「月額（通常）」として扱う。
  // 期日が同じ日にボーナスの回と月額の回が並ぶと、金額の大きいボーナスが
  // 先に埋まってしまう。振込人名からは月額ぶんかボーナスぶんか見分けられない。
  // ボーナスの回に入れてよいのは、人が「入金種類：ボーナス」と決めた入金だけ。
  const 絞る = 入金種類(種類) || '通常';
  // 各回の「すでに入っている額」も一緒に持ってくる(回ごとに聞き直さない)
  const 全部 = await sql(
    `SELECT s.id, s.no, s.kind, s.planned_amount,
            COALESCE((SELECT sum(a.amount) FROM allocation a
                       WHERE a.schedule_id = s.id),0)::int AS paid
       FROM schedule s
      WHERE s.customer_id=$1 AND s.state <> '入金済み'
      ORDER BY s.due_date, s.kind, s.no`, [customerId]);
  const rows = 充てる順(全部, 絞る);

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

// その回の督促の様子。未入金の一覧とダッシュボードで同じものを出す。
//
// 取り消しても日付と回数は消さない（dunned_undone_at を立てるだけ）。
// 押し間違えたときに、そのまま元へ戻せるようにするため。
// 取り消してあるあいだは「未督促」として扱い、取り消した中身は
// 「取り消した督促」として別に渡す。画面で「元に戻しますか」と聞ける。
function 督促の様子(回) {
  if (!回) return { 督促日: null, 督促回数: 0, 取り消した督促: null };
  const 回数 = Number(回.dunned_count) || 0;
  const 取消 = !!回.dunned_undone_at;
  if (取消 && 回数 > 0) {
    return { 督促日: null, 督促回数: 0,
             取り消した督促: { 日: 回.dunned_on || null, 回数 } };
  }
  return { 督促日: 取消 ? null : (回.dunned_on || null),
           督促回数: 取消 ? 0 : 回数,
           取り消した督促: null };
}

// 顧客のお金を、記録した順に、古い回へ詰め直す。
//
// 台帳の決めごとは「古い回から順に充てる」。ところが、入金を消したり、
// 顧客を付け替えたり、入金種類を変えたり、期日を動かしたりすると、
// **その入金の充当だけ**が付け直され、ほかの入金は前の回に残ってしまう。
// すると「1回目は未入金なのに3回目は入金済み」という並びになり、
// 支払いの記録を見た人が、何が起きているのか分からなくなる。
//
// だから、そういう操作のあとは顧客まるごと詰め直す。
// 入金の金額も件数も残債も変わらない。どの回に充てるかだけを並べ直す。
// ボーナスの回に入れてよいのは、人が「入金種類：ボーナス」と決めた入金だけ。
// 種類を決めていない入金は月額として扱う。期日が同じ日にボーナスの回と
// 月額の回が並ぶと、金額の大きいボーナスが先に埋まってしまうため。
//
// 詰める順は「入金を記録した順（id順）」。入金日の順ではない。
// あとから古い日付の入金を1件足しただけで、これまでの入金の行き先が
// 総入れ替えになると、支払いの記録を見ている人が驚く。
// もともとの台帳も、入れた順に古い回から充てていた。そこは変えない。
//
// 問い合わせは顧客1人につき4回。入金や回の数がいくつでも増えない。
// 返すのは入金ごとの余り（充てきれなかった額）。
async function 詰め直す(sql, customerId) {
  const [入金, 予定] = await Promise.all([
    sql(`SELECT id, amount, alloc_kind FROM payment
          WHERE customer_id=$1 ORDER BY id`, [customerId]),
    sql(`SELECT id, no, kind, planned_amount FROM schedule
          WHERE customer_id=$1 ORDER BY due_date, kind, no`, [customerId]),
  ]);
  await sql(`DELETE FROM allocation WHERE payment_id IN
               (SELECT id FROM payment WHERE customer_id=$1)`, [customerId]);

  const 埋まり = new Map(予定.map((s) => [s.id, 0]));
  const 余り = {};
  const 値 = [], 引数 = [];
  for (const p of 入金) {
    let 残 = p.amount;
    // 種類が決まっていない入金は月額として扱う（allocate と同じ決めごと）
    const 絞る = 入金種類(p.alloc_kind) || '通常';
    // '両方' のときだけ、まだ埋まっていないボーナスの回を1つ先に置く
    const 順 = 充てる順(予定.filter((s) => 埋まり.get(s.id) < s.planned_amount), 絞る);
    for (const s of 順) {
      if (残 <= 0) break;
      const あき = s.planned_amount - 埋まり.get(s.id);
      if (あき <= 0) continue;
      const 入 = Math.min(残, あき);
      引数.push(p.id, s.id, 入);
      const i = 引数.length;
      値.push(`($${i - 2},$${i - 1},$${i})`);
      埋まり.set(s.id, 埋まり.get(s.id) + 入);
      残 -= 入;
    }
    余り[p.id] = 残;
  }
  if (値.length) {
    await sql(`INSERT INTO allocation (payment_id, schedule_id, amount)
               VALUES ${値.join(',')}`, 引数);
  }
  await restateMany(sql, 予定.map((s) => s.id));
  return 余り;
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
  readBody, query, restateMany, allocate, unallocate, 詰め直す, summarize, makeSchedule,
  督促の様子, 充てる順,
  bonusDues, remakeBonus, 入金種類,
};
