import { useCallback, useEffect, useState } from 'react';
import { api, jpDate, 本日 } from './api';
import { Err } from './components/ui';
import Customers from './pages/Customers';
import CustomerPage from './pages/CustomerPage';
import PaymentEntry from './pages/PaymentEntry';
import History from './pages/History';
import Unpaid from './pages/Unpaid';
import Settings from './pages/Settings';

const TABS = [
  { key: 'customers', label: '顧客一覧' },
  { key: 'entry', label: '入金登録' },
  { key: 'history', label: '入金履歴' },
  { key: 'unpaid', label: '未入金' },
  { key: 'settings', label: '設定' },
];

export default function App() {
  const [me, setMe] = useState(null);          // null=確認中
  const [tab, setTab] = useState('customers');
  const [customerId, setCustomerId] = useState(null);   // 顧客ページを開いているとき
  const [jump, setJump] = useState(null);      // 未入金などから飛んできたときの検索語
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { api.me().then(setMe).catch(() => setMe({ ログイン中: false })); }, []);

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

  if (me === null) return <div className="login"><div className="login-box">読み込んでいます…</div></div>;
  if (!me.ログイン中) return <Login onDone={setMe} />;

  return (
    <div className="app">
      <header className="head">
        <div className="head-in">
          <h1 className="brand">入金管理台帳</h1>
          <span className="head-date">{jpDate(本日())}</span>
          <div className="head-right">
            <span className="head-date">{me.利用者}</span>
            <button
              className="btn btn-sm"
              onClick={() => api.logout().then(() => setMe({ ログイン中: false }))}
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
        {customerId ? (
          <CustomerPage id={customerId} onChanged={refresh} />
        ) : tab === 'customers' ? (
          <Customers key={reloadKey} onOpen={setCustomerId} onChanged={refresh} />
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
          <Unpaid key={reloadKey} onOpen={setCustomerId} goHistory={goHistory} />
        ) : (
          <Settings onChanged={refresh} />
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
