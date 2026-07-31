// サーバーとのやり取り。エラーはここで日本語にそろえる。

async function call(path, { method = 'GET', body } = {}) {
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

const q = (o) => {
  const s = new URLSearchParams();
  Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') s.set(k, v); });
  const t = s.toString();
  return t ? `?${t}` : '';
};

export const api = {
  // ログイン
  me: () => call('/api/session'),
  login: (user, pass) => call('/api/session', { method: 'POST', body: { user, pass } }),
  logout: () => call('/api/session', { method: 'DELETE' }),

  // 顧客
  customers: (opt) => call('/api/customers' + q(opt)),
  addCustomer: (body) => call('/api/customers', { method: 'POST', body }),
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
};

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
