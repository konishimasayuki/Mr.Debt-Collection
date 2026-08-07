import { useCallback, useEffect, useState } from 'react';
import { api, jpDate, 本日 } from './api';
import { Err, Loading } from './components/ui';
import Customers from './pages/Customers';
import Dashboard from './pages/Dashboard';
import CustomerPage from './pages/CustomerPage';
import PaymentEntry from './pages/PaymentEntry';
import History from './pages/History';
import Unpaid from './pages/Unpaid';
import Finished from './pages/Finished';
import Settings from './pages/Settings';
import Debug from './pages/Debug';

const TABS = [
  { key: 'dash', label: 'ダッシュボード' },
  { key: 'customers', label: '顧客一覧' },
  { key: 'entry', label: '入金登録' },
  { key: 'history', label: '入金履歴' },
  { key: 'unpaid', label: '未入金' },
  { key: 'finished', label: '終了' },
  { key: 'settings', label: '設定' },
  { key: 'debug', label: 'デバッグ依頼' },
];

// 前にこの端末でログインできていたか。
// 開いた直後、サーバーの返事を待たずに台帳の枠を出すために使う。
// 待ってから決めると、その間ずっと真っ白になる。
// これは見た目のための覚え書きで、合鍵ではない。
// 中身を見せるかどうかは、必ずサーバーの返事で決める。
const 覚えの鍵 = '入金管理台帳:前回ログインできた';
const 前回ログインできた = () => {
  try { return localStorage.getItem(覚えの鍵) === '1'; } catch { return false; }
};
const 覚える = (できた) => {
  try {
    if (できた) localStorage.setItem(覚えの鍵, '1');
    else localStorage.removeItem(覚えの鍵);
  } catch { /* 端末の設定で使えないことがある。覚えられなくても動く */ }
};

export default function App() {
  const [me, setMe] = useState(null);          // null=確認中
  const [tab, setTab] = useState('customers');
  const [customerId, setCustomerId] = useState(null);   // 顧客ページを開いているとき
  const [jump, setJump] = useState(null);      // 未入金などから飛んできたときの検索語
  const [reloadKey, setReloadKey] = useState(0);
  // 描き始めの一度だけ読む。あとから変わっても画面を切り替えない
  const [枠を先に出す] = useState(前回ログインできた);

  useEffect(() => {
    let 生きている = true;
    const 決める = (d) => {
      if (!生きている) return;
      覚える(!!d.ログイン中);
      setMe(d);
    };
    // 通信そのものが失敗したときは覚え書きを触らない。
    // 電波が悪かっただけで、次に開いたときまた真っ白になるのは困る。
    api.me().then(決める).catch(() => { if (生きている) setMe({ ログイン中: false }); });
    return () => { 生きている = false; };
  }, []);

  // ヘッダーの高さを測って CSS へ渡す。
  // 索引バーをこの下に貼り付けたいが、高さは端末と文字サイズで変わるため、
  // 決め打ちにすると隠れたり浮いたりする。
  useEffect(() => {
    const el = document.querySelector('.head');
    if (!el || typeof ResizeObserver !== 'function') return;
    const 測る = () => document.documentElement.style
      .setProperty('--head-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    測る();
    const ro = new ResizeObserver(測る);
    ro.observe(el);
    window.addEventListener('resize', 測る);
    return () => { ro.disconnect(); window.removeEventListener('resize', 測る); };
  }, [me]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // 未入金の行を押したら、入金履歴でその人を検索した状態にする。
  // 検索語は入金履歴が受け取ったら消す（下の onJumped）。持ったままにすると、
  // 検索欄を空にして別のタブへ行き、戻ってきたときに古い名前でまた絞り込まれる。
  const goHistory = useCallback((name) => {
    setJump({ 名前: name || '' });
    setCustomerId(null);
    setTab('history');
  }, []);
  const onJumped = useCallback(() => setJump(null), []);

  const goTab = (key) => { setCustomerId(null); setTab(key); };

  const 確認中 = me === null;
  // はじめて開いた端末だけは、ログイン画面と台帳のどちらを出すか分からない。
  // 出してから入れ替えると画面が飛ぶので、ここだけは返事を待つ。
  if (確認中 && !枠を先に出す) {
    return <div className="login"><div className="login-box">読み込んでいます…</div></div>;
  }
  if (!確認中 && !me.ログイン中) return <Login onDone={(d) => { 覚える(true); setMe(d); }} />;

  return (
    <div className="app">
      <header className="head">
        <div className="head-in">
          <h1 className="brand">入金管理台帳</h1>
          <span className="head-date">{jpDate(本日())}</span>
          <div className="head-right">
            <span className="head-date">{確認中 ? '' : me.利用者}</span>
            <button
              className="btn btn-sm"
              disabled={確認中}
              onClick={() => api.logout()
                .then(() => { 覚える(false); setMe({ ログイン中: false }); })}
            >ログアウト</button>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={'tab' + (tab === t.key && !customerId ? ' on' : '')}
              onClick={() => goTab(t.key)}
            >{t.label}</button>
          ))}
        </nav>
      </header>

      <main className="main">
        {/* 確認が終わるまでは骨組みだけ。
            先に中身を出すと、まだ合鍵が確かめられていないので
            どの表も「ログインが必要です」で埋まってしまう */}
        {確認中 ? (
          <>
            <div className="bar"><h2>顧客一覧</h2></div>
            <Loading 件数={6} />
          </>
        ) : customerId ? (
          <CustomerPage id={customerId} onChanged={refresh} />
        ) : tab === 'customers' ? (
          <Customers key={reloadKey} onOpen={setCustomerId} onChanged={refresh} />
        ) : tab === 'dash' ? (
          <Dashboard key={reloadKey} onOpen={setCustomerId} />
        ) : tab === 'entry' ? (
          <PaymentEntry onChanged={refresh} goHistory={goHistory} />
        ) : tab === 'history' ? (
          <History
            jump={jump}
            onJumped={onJumped}
            onOpen={setCustomerId}
            onChanged={refresh}
          />
        ) : tab === 'unpaid' ? (
          <Unpaid key={reloadKey} onOpen={setCustomerId} onChanged={refresh} />
        ) : tab === 'finished' ? (
          <Finished key={reloadKey} onOpen={setCustomerId} />
        ) : tab === 'debug' ? (
          <Debug />
        ) : (
          <Settings onOpen={setCustomerId} onChanged={refresh} />
        )}
      </main>
    </div>
  );
}

function Login({ onDone }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { onDone(await api.login(user, pass)); }
    catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="login">
      <form className="login-box" onSubmit={submit}>
        <h1>入金管理台帳</h1>
        <p>利用者名とパスワードを入れてください。</p>
        <div className="f">
          <label>利用者名</label>
          <input value={user} onChange={(e) => setUser(e.target.value)} autoFocus autoComplete="username" />
        </div>
        <div className="f">
          <label>パスワード</label>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)}
                 autoComplete="current-password" />
        </div>
        <Err>{err}</Err>
        <button className="btn btn-main" style={{ width: '100%' }} disabled={busy}>
          {busy ? '確認しています…' : 'ログイン'}
        </button>
      </form>
    </div>
  );
}
