// サーバーとのやり取り。エラーはここで日本語にそろえる。

async function 送る(path, method, body) {
  let r;
  try {
    r = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('通信に失敗しました。ネットワークを確かめてください。');
  }
  let d = {};
  try { d = await r.json(); } catch { /* 本文が無いこともある */ }
  if (r.status === 401) { const e = new Error('ログインが必要です。'); e.未ログイン = true; throw e; }
  if (!r.ok || d.error) throw new Error(d.理由 ? `${d.error}\n${d.理由}` : (d.error || `サーバーが ${r.status} を返しました。`));
  return d;
}

// ── 同じものを何度も取りに行かない ────────────────
// サーバーは遠くにあり、1回の問い合わせに待ち時間がかかる。
// タブを行き来するたびに同じ一覧を取りに行くと、そのたび待たされる。
//
// 1) 同じ問い合わせが同時に走ったら、1つにまとめる
// 2) 一度取ったものは、ごく短い間だけ覚えておく
// 3) 書き込み（登録・変更・削除）があったら、覚えているものは全部捨てる
//    ─ 古い数字を出さないため。金額を扱うので、ここは短めにしておく。
//
// 「世代」で捨てる。取りに行っている最中に書き込みが起きると、
// 返ってきた中身はもう古い。捨てたあとにそれが控えへ入らないよう、
// 送るときの世代と、返ってきたときの世代が同じときだけ覚える。
const 覚えておく時間 = 5000;
const 控え = new Map();
const 進行中 = new Map();
let 世代 = 0;
const 全部捨てる = () => { 世代++; 控え.clear(); 進行中.clear(); };

function call(path, { method = 'GET', body } = {}) {
  const 読み取り = method === 'GET';
  if (読み取り) {
    const c = 控え.get(path);
    if (c && Date.now() - c.時刻 < 覚えておく時間) return Promise.resolve(c.中身);
    const 先客 = 進行中.get(path);
    if (先客) return 先客;
  } else {
    全部捨てる();   // 書き込みが始まった時点で、覚えているものは古い
  }

  const いまの世代 = 世代;
  const p = 送る(path, method, body);
  if (読み取り) {
    進行中.set(path, p);
    p.then(
      (d) => { if (世代 === いまの世代) 控え.set(path, { 時刻: Date.now(), 中身: d }); },
      () => {})
      .then(() => { if (進行中.get(path) === p) 進行中.delete(path); });
  } else {
    p.then(() => {}, () => {}).then(全部捨てる);
  }
  return p;
}

const q = (o) => {
  const s = new URLSearchParams();
  Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') s.set(k, v); });
  const t = s.toString();
  return t ? `?${t}` : '';
};

// 別の道で手に入った中身を、控えに入れておく。
// 取りに行っている間に書き込みが起きていたら（世代が進んでいたら）入れない。
function 控えておく(path, 中身, いまの世代) {
  if (世代 === いまの世代) 控え.set(path, { 時刻: Date.now(), 中身 });
}

export const api = {
  // ログイン。開いた直後は顧客一覧も一緒に受け取り、往復を1回で済ませる。
  me: () => {
    const いまの世代 = 世代;
    return call('/api/session?顧客=1').then((d) => {
      if (d.顧客) 控えておく('/api/customers', { 顧客: d.顧客, 本日: d.本日 }, いまの世代);
      return d;
    });
  },
  login: (user, pass) => call('/api/session', { method: 'POST', body: { user, pass } }),
  logout: () => call('/api/session', { method: 'DELETE' }),

  // 顧客
  customers: (opt) => call('/api/customers' + q(opt)),
  addCustomer: (body) => call('/api/customers', { method: 'POST', body }),
  patchCustomers: (body) => call('/api/customers', { method: 'PATCH', body }),
  customer: (id) => call('/api/customer' + q({ id })),
  patchCustomer: (body) => call('/api/customer', { method: 'PATCH', body }),
  postCustomer: (body) => call('/api/customer', { method: 'POST', body }),

  // 入金
  payments: (opt) => call('/api/payments' + q(opt)),
  addPayment: (body) => call('/api/payments', { method: 'POST', body }),
  patchPayment: (body) => call('/api/payments', { method: 'PATCH', body }),
  deletePayment: (id) => call('/api/payments' + q({ id }), { method: 'DELETE' }),

  // 取り込み
  preview: (text) => call('/api/import', { method: 'POST', body: { text } }),
  commit: (明細) => call('/api/import', { method: 'POST', body: { 実行: true, 明細 } }),
  assign: (割当) => call('/api/import', { method: 'POST', body: { 割当 } }),

  // 設定
  companies: () => call('/api/companies'),
  addCompany: (body) => call('/api/companies', { method: 'POST', body }),
  patchCompany: (body) => call('/api/companies', { method: 'PATCH', body }),
  deleteCompany: (id) => call('/api/companies' + q({ id }), { method: 'DELETE' }),
  setup: (body) => call('/api/setup', { method: 'POST', body: body || {} }),

  // デバッグ依頼
  debugList: () => call('/api/debug'),
  debugOne: (id) => call('/api/debug' + q({ id })),
  addDebug: (body) => call('/api/debug', { method: 'POST', body }),
  patchDebug: (body) => call('/api/debug', { method: 'PATCH', body }),
  deleteDebug: (id) => call('/api/debug' + q({ id }), { method: 'DELETE' }),

  // 動作を試すための顧客
  testCustomer: () => call('/api/testcustomer'),
  makeTestCustomer: () => call('/api/testcustomer', { method: 'POST' }),
  deleteTestCustomer: () => call('/api/testcustomer', { method: 'DELETE' }),
};

// デバッグ依頼に付いた画像の場所。<img src> にそのまま入れる。
// ログインしていないと返ってこない（合鍵はクッキーで一緒に飛ぶ）。
export const 画像URL = (id, 小) =>
  '/api/debugimage?' + new URLSearchParams(小 ? { id, 小: 1 } : { id }).toString();

// ── 表示用の小道具 ────────────────────────────
export const yen = (n) => Number(n || 0).toLocaleString('ja-JP');
export const ymd = (s) => (s ? String(s).replace(/-/g, '/') : '');
export const md = (s) => (s ? String(s).slice(5).replace('-', '/') : '');

export function jpDate(s) {
  if (!s) return '';
  const [y, m, d] = String(s).split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

// 検索の正規化。かな・全角カナ・半角カナ・半角英字・全角英字のどれでも当たる
export function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s　]/g, '')
    .replace(/[()（）.,･・ー\-‐―－]/g, '')
    .toLowerCase();
}

export const 本日 = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
