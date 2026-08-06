// デバッグ依頼。
//
// 電話を受けている最中に「画面がおかしい」と気づいても、
// その場で伝える先が無いと忘れてしまう。
// 画面の写しを付けてそのまま出せるようにする。
// 出したあとは、返信で画像とメッセージをやり取りできる。
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, 画像URL } from '../api';
import { Modal, Text, Err, Empty, Note, Loading } from '../components/ui';
import { 縮める, 送る形, 上限枚数 } from '../shrink';

const 状態一覧 = ['未対応', '対応中', '直した'];
const 状態の色 = { 未対応: 't-late', 対応中: 't-dup', 直した: 't-done' };

// ── 画像を選ぶところ ──────────────────────────
// ファイルから選ぶだけでなく、貼り付け（Ctrl+V）でも入れられるようにする。
// パソコンで画面を写したときは、そのまま貼れるほうが早い。
function use画像() {
  const [画像, set画像] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // いま何枚あるかを、状態の更新を待たずに数えられるようにしておく。
  // 複数枚をまとめて選んだとき、枚数の上限をその場で見るため
  const 現在 = useRef([]);

  const 足す = useCallback(async (list) => {
    const 並び = [...(list || [])].filter((f) => f && String(f.type || '').startsWith('image/'));
    if (!並び.length) return;
    setBusy(true); setErr('');
    const 追加 = [];
    for (const f of 並び) {
      if (現在.current.length + 追加.length >= 上限枚数) {
        setErr(`画像は${上限枚数}枚までです。`);
        break;
      }
      try { 追加.push(await 縮める(f)); }
      catch (e) { setErr(e.message); }
    }
    if (追加.length) {
      現在.current = [...現在.current, ...追加];
      set画像(現在.current);
    }
    setBusy(false);
  }, []);

  const 外す = useCallback((i) => {
    現在.current = 現在.current.filter((_, j) => j !== i);
    set画像(現在.current);
  }, []);

  const 空にする = useCallback(() => { 現在.current = []; set画像([]); setErr(''); }, []);

  return { 画像, err, setErr, busy, 足す, 外す, 空にする };
}

function Attach({ 束, id }) {
  const 入力 = useRef(null);
  return (
    <div className="att">
      <div className="row-btn">
        <button type="button" className="btn btn-sm" disabled={束.busy}
                onClick={() => 入力.current && 入力.current.click()}>
          {束.busy ? '小さくしています…' : '画像を選ぶ'}
        </button>
        <span className="att-hint">
          画面の写しを {上限枚数}枚まで付けられます。貼り付け（Ctrl+V）でも入ります。
        </span>
      </div>
      <input
        ref={入力} id={id} type="file" accept="image/*" multiple
        style={{ display: 'none' }}
        onChange={(e) => { 束.足す(e.target.files); e.target.value = ''; }}
      />
      <Err>{束.err}</Err>
      {束.画像.length > 0 && (
        <div className="att-list">
          {束.画像.map((g, i) => (
            <div className="att-i" key={i}>
              <img src={g.見本} alt={g.名前} />
              <button type="button" className="att-x" title="外す"
                      onClick={() => 束.外す(i)}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 送られた画像を並べる。押すと原寸で見られる
function Shots({ 画像, 開く }) {
  if (!画像 || !画像.length) return null;
  return (
    <div className="att-list">
      {画像.map((g) => (
        <button type="button" className="att-i" key={g.id} onClick={() => 開く(g)}>
          <img src={画像URL(g.id, true)} alt={g.名前 || '画面の写し'} loading="lazy" />
        </button>
      ))}
    </div>
  );
}

// 原寸で見る。画面いっぱいに出す
function Viewer({ 画像, onClose }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="viewer" onClick={onClose}>
      <img src={画像URL(画像.id)} alt={画像.名前 || '画面の写し'} />
      <div className="viewer-foot">
        <button className="btn" onClick={onClose}>閉じる</button>
        <a className="btn" href={画像URL(画像.id)} target="_blank" rel="noreferrer"
           onClick={(e) => e.stopPropagation()}>別の窓で開く</a>
      </div>
    </div>
  );
}

// ── 一覧 ─────────────────────────────────
export default function Debug() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [新規, set新規] = useState(false);
  const [開いている, set開いている] = useState(null);   // 依頼id
  const [直したも, set直したも] = useState(false);

  const load = useCallback(() => {
    setErr('');
    api.debugList().then((d) => setRows(d.依頼)).catch((e) => { setRows([]); setErr(e.message); });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (開いている) {
    return <Thread id={開いている} onBack={() => { set開いている(null); load(); }} />;
  }

  const 出す = (rows || []).filter((t) => 直したも || t.状態 !== '直した');
  const 隠した = (rows || []).length - 出す.length;

  return (
    <>
      <div className="bar">
        <h2>デバッグ依頼</h2>
        {rows && <span className="sub">{出す.length}件</span>}
        <div className="bar-right">
          <label className="chk">
            <input type="checkbox" checked={直したも}
                   onChange={(e) => set直したも(e.target.checked)} />
            直したものも出す{隠した > 0 && `（${隠した}件）`}
          </label>
          <button className="btn btn-main" onClick={() => set新規(true)}>＋ デバッグ依頼を出す</button>
        </div>
      </div>

      <Note>
        使っていておかしいと思ったこと、こうしてほしいことを、画面の写しを付けて出せます。
        出したあとは、この画面で返信のやり取りができます。
        画面の写しには顧客のお名前や金額が写ります。ログインした人だけが見られます。
      </Note>
      <Err>{err}</Err>

      {rows === null && <Loading 件数={3} />}

      {rows && 出す.length === 0 && (
        <div className="card"><Empty>
          {rows.length ? '未対応の依頼はありません。' : 'まだ依頼はありません。'}
        </Empty></div>
      )}

      <div className="dbg-list">
        {出す.map((t) => (
          <button type="button" className="dbg-c" key={t.id} onClick={() => set開いている(t.id)}>
            <div className="dbg-h">
              <span className={'tag ' + 状態の色[t.状態]}>{t.状態}</span>
              <b>{t.題名}</b>
              <span className="dbg-d">{t.日時}</span>
            </div>
            {t.本文 && <p className="dbg-b">{t.本文}</p>}
            <div className="dbg-f">
              {t.画像.length > 0 && (
                <span className="dbg-th">
                  {t.画像.slice(0, 4).map((g) => (
                    <img key={g.id} src={画像URL(g.id, true)} alt="" loading="lazy" />
                  ))}
                  {t.画像.length > 4 && <i>ほか{t.画像.length - 4}枚</i>}
                </span>
              )}
              <span className="dbg-n">
                {t.返信数 > 0 ? `返信 ${t.返信数}件` : '返信なし'}
              </span>
            </div>
          </button>
        ))}
      </div>

      {新規 && (
        <NewTicket onClose={() => set新規(false)}
                   onDone={(id) => { set新規(false); load(); set開いている(id); }} />
      )}
    </>
  );
}

// ── 新しい依頼 ───────────────────────────
function NewTicket({ onClose, onDone }) {
  const [題名, set題名] = useState('');
  const [本文, set本文] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const 束 = use画像();

  const submit = async () => {
    if (!題名.trim()) return setErr('タイトルを入れてください。');
    setBusy(true); setErr('');
    try {
      const d = await api.addDebug({
        題名: 題名.trim(), 本文, 画像: 束.画像.map(送る形),
      });
      onDone(d.id);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Modal
      title="デバッグ依頼を出す"
      onClose={onClose}
      wide
      foot={
        <>
          <button className="btn" onClick={onClose}>キャンセル</button>
          <div className="right">
            <button className="btn btn-main" onClick={submit} disabled={busy || 束.busy}>
              {busy ? '送っています…' : '出す'}
            </button>
          </div>
        </>
      }
    >
      <Text label="タイトル" value={題名} onChange={set題名}
            placeholder="未入金の合計が合わない" />
      <div className="f">
        <label>本文</label>
        <textarea
          rows={6} value={本文}
          onChange={(e) => set本文(e.target.value)}
          onPaste={(e) => 束.足す(e.clipboardData && e.clipboardData.files)}
          placeholder={'どの画面で、何をしたら、どうなったかを書いてください。\n'
            + '例）未入金タブを開いたら、合計が顧客ページの残債と合っていません。'}
        />
        <span className="hint">この欄に画像を貼り付け（Ctrl+V）でも添付できます。</span>
      </div>
      <Attach 束={束} id="dbg-new-file" />
      <Err>{err}</Err>
    </Modal>
  );
}

// ── 1件のやり取り ──────────────────────────
function Thread({ id, onBack }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState('');
  const [本文, set本文] = useState('');
  const [busy, setBusy] = useState(false);
  const [見ている, set見ている] = useState(null);   // 原寸で見ている画像
  const 束 = use画像();

  const load = useCallback(() => {
    setErr('');
    api.debugOne(id).then((d) => setT(d.依頼)).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const 状態を変える = async (状態) => {
    if (!t || t.状態 === 状態) return;
    setErr('');
    try { await api.patchDebug({ id, 状態 }); load(); }
    catch (e) { setErr(e.message); }
  };

  const 返信する = async () => {
    if (!本文.trim() && !束.画像.length) {
      return setErr('メッセージか画像のどちらかを入れてください。');
    }
    setBusy(true); setErr('');
    try {
      await api.addDebug({ 依頼: id, 本文, 画像: 束.画像.map(送る形) });
      set本文(''); 束.空にする(); load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const 消す = async () => {
    if (!confirm(`「${t.題名}」を、返信と画像ごと消します。\nよろしいですか。`)) return;
    setErr('');
    try { await api.deleteDebug(id); onBack(); }
    catch (e) { setErr(e.message); }
  };

  if (!t) {
    return (
      <>
        <div className="bar">
          <button className="btn btn-sm" onClick={onBack}>← 一覧へ戻る</button>
        </div>
        <Err>{err}</Err>
        {!err && <Loading 件数={2} />}
      </>
    );
  }

  return (
    <>
      <div className="bar">
        <button className="btn btn-sm" onClick={onBack}>← 一覧へ戻る</button>
      </div>

      <h2 className="dbg-title">{t.題名}</h2>
      <div className="dbg-sub">{t.投稿者}／{t.日時}</div>

      <div className="dbt-pick">
        {状態一覧.map((s) => (
          <button
            key={s} type="button"
            className={'dbt-o' + (t.状態 === s ? ' on' : '')}
            onClick={() => 状態を変える(s)}
          >
            <b>{s}</b>
            <i>{s === '未対応' ? 'まだ見ていない'
              : s === '対応中' ? 'いま直している' : '直し終わった'}</i>
          </button>
        ))}
      </div>

      <Err>{err}</Err>

      <div className="sec">
        {t.本文
          ? <p className="dbg-body">{t.本文}</p>
          : <p className="dbg-body none">（本文はありません）</p>}
        <Shots 画像={t.画像} 開く={set見ている} />
      </div>

      {t.返信.map((m) => (
        <div className="sec dbg-re" key={m.id}>
          <div className="dbg-sub">{m.投稿者}／{m.日時}</div>
          {m.本文 && <p className="dbg-body">{m.本文}</p>}
          <Shots 画像={m.画像} 開く={set見ている} />
        </div>
      ))}

      <div className="sec">
        <h3>返信する</h3>
        <div className="f">
          <textarea
            rows={4} value={本文}
            onChange={(e) => set本文(e.target.value)}
            onPaste={(e) => 束.足す(e.clipboardData && e.clipboardData.files)}
            placeholder="分かったこと、直したこと、追加で困っていることを書いてください。"
          />
        </div>
        <Attach 束={束} id="dbg-re-file" />
        <div className="row-btn" style={{ marginTop: 10 }}>
          <button className="btn btn-main" onClick={返信する} disabled={busy || 束.busy}>
            {busy ? '送っています…' : '返信する'}
          </button>
        </div>
      </div>

      {/* 消すのはいちばん下。取り消せない操作なので、
          指で操作する端末でいちばん押しやすい場所には置かない */}
      <div className="dbg-del">
        <button className="btn btn-sm btn-danger" onClick={消す}>この依頼を消す</button>
        <span className="hint">返信と画像も一緒に消えます。元には戻せません。</span>
      </div>

      {見ている && <Viewer 画像={見ている} onClose={() => set見ている(null)} />}
    </>
  );
}
