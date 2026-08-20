import { useEffect, useState } from 'react';
import { api, yen, norm } from '../api';
import { Modal, Text, Select, Err, Note, Empty, Loading } from '../components/ui';

export default function Settings({ onOpen, onChanged }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);

  const load = () => {
    setErr('');
    api.companies().then((d) => setRows(d.会社)).catch((e) => { setRows([]); setErr(e.message); });
  };
  useEffect(load, []);

  const remove = async (c) => {
    if (!confirm(`債権会社「${c.名前}」を削除します。よろしいですか。`)) return;
    try {
      await api.deleteCompany(c.id);
      load(); onChanged && onChanged();
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div className="bar">
        <h2>設定</h2>
        <div className="bar-right">
          <button className="btn btn-main" onClick={() => setOpen(true)}>＋ 債権会社を追加</button>
        </div>
      </div>

      <div className="sec">
        <h3>債権会社</h3>
        <Note>
          ここで登録した会社が、新規顧客登録の「債権譲渡会社」「債権譲渡先」の選択肢になります。
          顧客に使われている会社は削除できません。
        </Note>
        <Err>{err}</Err>

        <div className="card tw cards">
          <table>
            <thead>
              <tr><th>会社名</th><th>メモ</th><th className="num">使用中の顧客</th><th /></tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={4}><Loading 件数={2} 行={1} /></td></tr>}
              {rows && rows.length === 0 && (
                <tr><td colSpan={4}><Empty>
                  まだ登録がありません。「債権会社を追加」から入れてください。
                </Empty></td></tr>
              )}
              {rows && rows.map((c) => (
                <tr key={c.id}>
                  <td className="nm"><b>{c.名前}</b></td>
                  <td data-label="メモ" style={{ whiteSpace: 'normal', fontSize: 13 }}>{c.メモ || ''}</td>
                  <td className="num" data-label="使用中の顧客">{c.使用数}件</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => setEdit(c)}>編集</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(c)}>削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <BankAccounts />

      <DeleteCustomer onChanged={onChanged} />


      <TestCustomer onOpen={onOpen} onChanged={onChanged} />

      {(open || edit) && (
        <CompanyForm
          c={edit}
          onClose={() => { setOpen(false); setEdit(null); }}
          onDone={() => { setOpen(false); setEdit(null); load(); onChanged && onChanged(); }}
        />
      )}
    </>
  );
}

// ── 顧客を消す ───────────────────────────────
//
// 登録し間違えた顧客を片づけるための道。
// 消せるのは、入金が1件も無い顧客だけ。1円でも受け取っていれば消せない。
// お金の跡を消させないため。消したことは記録に残す。
//
// 一覧には**全員を出す**。同じ氏名の方が2人いるとき、消せるほうだけを
// 出すと、どちらを消しているのか分からないまま押すことになる。
function DeleteCustomer({ onChanged }) {
  const [d, setD] = useState(null);
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(0);

  const load = () => api.deletable().then(setD)
    .catch((e) => { setD({ 顧客: [] }); setErr(e.message); });
  useEffect(() => { load(); }, []);

  // 一緒に消えるもの。押す前に「何か書いてないか」「約束していないか」を確かめる
  const 消えるもの = (c) => [
    c.支払予定回数 ? `支払予定 ${c.支払予定回数}回` : '',
    c.約束件数 ? `入金約束 ${c.約束件数}件` : '',
    c.メモ件数 ? `回のメモ ${c.メモ件数}件` : '',
    c.顧客メモあり ? 'この顧客についてのメモ' : '',
    c.記録件数 ? `記録 ${c.記録件数}件` : '',
  ].filter(Boolean);

  const 消す = async (c) => {
    const 中身 = 消えるもの(c);
    // 名前を出して二度聞く。押し間違いで消えては困る
    if (!confirm(`${c.氏名}${c.よみ ? `（${c.よみ}）` : ''} さんを消します。\n\n`
      + `一緒に消えるもの：\n${中身.map((x) => `・${x}`).join('\n')}\n\n`
      + '元には戻せません。よろしいですか。')) return;
    if (!confirm(`もう一度お聞きします。\n\n「${c.氏名}」を消してよろしいですか。`)) return;
    setBusy(c.id); setErr('');
    try {
      await api.deleteCustomer(c.id);
      await load();
      onChanged && onChanged();
    } catch (e) { setErr(e.message); }
    finally { setBusy(0); }
  };

  // かな・カナ・漢字のどれで打っても当たる（顧客一覧の検索と同じそろえ方）
  const k = norm(key);
  const 出す = d
    ? d.顧客.filter((c) => !k || norm(c.氏名).includes(k) || norm(c.よみ).includes(k))
    : [];
  const 消せる数 = d ? d.顧客.filter((c) => c.消せる).length : 0;

  return (
    <div className="sec">
      <h3>顧客を消す</h3>
      <Note kind="warn">
        <b>消せるのは、入金が1件も無い顧客だけです。</b>
        {' '}1円でも受け取っている顧客は消せません。お金の跡を消さないためです。
        <br />
        <b>同じ氏名の方がいても分かるように、一覧には全員を出しています。</b>
        よみ・車種・登録日で見分けてください。
        <br />
        登録し間違えた顧客を片づけるための欄です。
        <b>消すと支払予定・入金約束・メモも一緒に消え、元には戻せません。</b>
        消したことは記録に残ります。
      </Note>
      <Err>{err}</Err>

      {d === null && <Loading 件数={3} 行={1} />}
      {d && d.顧客.length === 0 && <Empty>顧客の登録がありません。</Empty>}

      {d && d.顧客.length > 0 && (
        <>
          <div className="row-btn" style={{ marginBottom: 10 }}>
            <input className="search" placeholder="氏名・よみで絞る"
                   value={key} onChange={(e) => setKey(e.target.value)} />
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
              全{d.顧客.length}名 ／ 消せる <b>{消せる数}名</b>
            </span>
          </div>
          <div className="ex-list">
            {出す.map((c) => (
              <div className={'del-row' + (c.消せる ? '' : ' keep')} key={c.id}>
                <div className="del-who">
                  <b>{c.氏名}</b>
                  {c.よみ && <span className="del-kana">{c.よみ}</span>}
                  {c.テスト && <span className="tag t-test">テスト</span>}
                  {c.引き上げ && <span className="tag t-warn">引き上げ</span>}
                </div>
                <div className="del-what">
                  月々 {yen(c.月々の金額)}円 × {c.回数}回
                  {c.車種 ? `　${c.車種}` : ''}　{c.登録日} 登録
                </div>
                {/* 何が入っているか。押す前にここで確かめられる */}
                <div className="del-has">
                  {c.入金件数 > 0
                    ? <b className="del-ng">入金 {c.入金件数}件</b>
                    : <span>入金 なし</span>}
                  {c.約束件数 > 0 && <b>入金約束 {c.約束件数}件</b>}
                  {c.メモ件数 > 0 && <b>回のメモ {c.メモ件数}件</b>}
                  {c.顧客メモあり && <b>顧客のメモ あり</b>}
                  {c.約束件数 === 0 && c.メモ件数 === 0 && !c.顧客メモあり
                    && <span>約束・メモ なし</span>}
                </div>
                <div className="del-act">
                  {c.消せる ? (
                    <button className="btn btn-sm btn-danger" disabled={busy === c.id}
                            onClick={() => 消す(c)}>
                      {busy === c.id ? '消しています…' : 'この顧客を削除'}
                    </button>
                  ) : (
                    <span className="del-lock">入金があるので消せません</span>
                  )}
                </div>
              </div>
            ))}
            {出す.length === 0 && <p className="ex-none">当たる顧客がいません。</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ── 動作を試すための顧客 ─────────────────────────
// 本物の顧客で練習させないために置く。
// おかしくなったら作り直せばよい、と分かる場所に置いておく。
function TestCustomer({ onOpen, onChanged }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.testCustomer().then(setT).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const 用意する = async () => {
    if (t && t.ある && !confirm(
      `「${t.氏名}」を作り直します。\n`
      + '今入っている入金・約束・メモはすべて消えます。よろしいですか。')) return;
    setBusy(true); setErr('');
    try {
      const d = await api.makeTestCustomer();
      await load();
      onChanged && onChanged();
      alert(`${d.氏名}さんを用意しました。\n`
        + `${d.初回} から ${d.最終回} まで、全12回。\n`
        + `1回目は入金済み、2回目は一部入金、${d.約束日} に入金約束が入っています。`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const 消す = async () => {
    if (!confirm(`「${t.氏名}」と、その入金・約束・メモをすべて消します。\n`
      + 'よろしいですか。')) return;
    setBusy(true); setErr('');
    try { await api.deleteTestCustomer(); await load(); onChanged && onChanged(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="sec">
      <h3>動作を試すための顧客</h3>
      <Note>
        本物の顧客で練習しなくて済むように、試しに使える顧客を1件だけ置けます。
        顧客一覧では <span className="tag t-test">テスト</span> の印が付き、
        入金・入金約束・メモ・CSVの取り込みを自由に試せます。
        分からなくなったら、作り直してください。
      </Note>
      <Err>{err}</Err>

      <div className="row-btn">
        {t && t.ある && (
          <button className="btn" onClick={() => onOpen(t.id)}>
            {t.氏名} の顧客ページを開く
          </button>
        )}
        <button className="btn btn-main" onClick={用意する} disabled={busy}>
          {t && t.ある ? '最初の状態に戻す' : 'テスト用の顧客を用意する'}
        </button>
        {t && t.ある && (
          <button className="btn btn-danger" onClick={消す} disabled={busy}>削除</button>
        )}
      </div>
    </div>
  );
}


// ── 銀行口座 ───────────────────────────
// 明細を取りに行く先。合鍵（接続の鍵）はここには入れない。
// 鍵はVercelの環境変数に置く（画面から見えるところに置かない）。
function BankAccounts() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [開く, set開く] = useState(null);   // 口座 or 'new'

  const load = () => {
    setErr('');
    api.bank().then(setD).catch((e) => { setD({ 口座: [], 差し込み口: [] }); setErr(e.message); });
  };
  useEffect(load, []);

  return (
    <div className="sec">
      <h3>銀行口座</h3>
      <Note>
        入金明細を取りに行く先です。<b>取ってくるだけで、入金にはなりません。</b>
        入金登録タブの「銀行から取り込む」で、人が確かめてから入金にします。
        <br />
        接続の鍵は、この画面には入れません。置き場所は別に用意します。
      </Note>
      <Err>{err}</Err>

      <div className="card tw">
        <table>
          <thead>
            <tr><th>銀行</th><th>支店</th><th>口座</th><th>差し込み口</th>
              <th>最後に取れた</th><th>使う</th><th /></tr>
          </thead>
          <tbody>
            {d === null && <tr><td colSpan={7}><Loading 件数={2} /></td></tr>}
            {d && d.口座.length === 0 && (
              <tr><td colSpan={7}><Empty>
                まだ登録がありません。「銀行口座を追加」から入れてください。
              </Empty></td></tr>
            )}
            {d && d.口座.map((a) => (
              <tr key={a.id}>
                <td><b>{a.銀行名}</b></td>
                <td>{a.支店 || '—'}</td>
                <td className="mono">{a.下4桁 ? `…${a.下4桁}` : '—'}</td>
                <td>{a.差し込み口}</td>
                <td style={{ fontSize: 12.5 }}>
                  {a.最後に取れた || <span className="tag t-warn">未取得</span>}
                  {a.最後の失敗 && (
                    <div style={{ color: 'var(--overdue)', fontSize: 12 }}>{a.最後の失敗}</div>
                  )}
                </td>
                <td>{a.使う
                  ? <span className="tag t-done">使う</span>
                  : <span className="tag t-csv">止めている</span>}</td>
                <td><button className="btn btn-sm" onClick={() => set開く(a)}>編集</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row-btn">
        <button className="btn btn-main" onClick={() => set開く('new')}>＋ 銀行口座を追加</button>
      </div>

      {開く && (
        <BankAccountForm
          a={開く === 'new' ? null : 開く}
          差し込み口={(d && d.差し込み口) || []}
          onClose={() => set開く(null)}
          onDone={() => { set開く(null); load(); }}
        />
      )}
    </div>
  );
}

function BankAccountForm({ a, 差し込み口, onClose, onDone }) {
  const [v, setV] = useState({
    銀行名: a ? a.銀行名 : '', 支店: a ? a.支店 : '', 下4桁: a ? a.下4桁 : '',
    差し込み口: a ? a.差し込み口 : (差し込み口[0] ? 差し込み口[0].kind : ''),
    銀行側の識別子: a ? a.銀行側の識別子 : '', 使う: a ? a.使う : true,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((o) => ({ ...o, [k]: val }));
  const 選んだ口 = 差し込み口.find((x) => x.kind === v.差し込み口);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await api.saveBankAccount(a ? { id: a.id, ...v } : v);
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Modal
      title={a ? '銀行口座の編集' : '銀行口座の追加'}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>キャンセル</button>
          <div className="right">
            <button className="btn btn-main" onClick={submit} disabled={busy}>
              {busy ? '保存しています…' : a ? '保存する' : '追加する'}
            </button>
          </div>
        </>
      }
    >
      <div className="grid2">
        <Text label="銀行名" value={v.銀行名} onChange={set('銀行名')} placeholder="◯◯銀行" />
        <Text label="支店" value={v.支店} onChange={set('支店')} placeholder="本店営業部" />
      </div>
      <Text label="口座番号の下4桁" value={v.下4桁} onChange={set('下4桁')}
            placeholder="1234" hint="どの口座か見分けるためだけに使います" />
      <Select label="差し込み口" value={v.差し込み口} onChange={set('差し込み口')}
              options={差し込み口.map((x) => ({ value: x.kind, label: x.名前 }))}
              hint={選んだ口 ? 選んだ口.説明 : '銀行ごとのつなぎ方です'} />
      <Text label="銀行側の識別子" value={v.銀行側の識別子} onChange={set('銀行側の識別子')}
            placeholder="銀行から知らされた口座の番号など"
            hint="銀行との接続で、どの口座かを指すものです。分からなければ空のままで構いません" />
      <Select label="使うか" value={v.使う ? '使う' : '止める'}
              onChange={(x) => set('使う')(x === '使う')}
              options={[{ value: '使う', label: '使う（取りに行く）' },
                        { value: '止める', label: '止めている（取りに行かない）' }]} />
      <Err>{err}</Err>
    </Modal>
  );
}

function CompanyForm({ c, onClose, onDone }) {
  const [v, setV] = useState({ 名前: c ? c.名前 : '', メモ: c ? c.メモ : '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((o) => ({ ...o, [k]: val }));

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      if (c) await api.patchCompany({ id: c.id, ...v });
      else await api.addCompany(v);
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Modal
      title={c ? '債権会社の編集' : '債権会社の追加'}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>キャンセル</button>
          <div className="right">
            <button className="btn btn-main" onClick={submit} disabled={busy}>
              {busy ? '保存しています…' : c ? '保存する' : '追加する'}
            </button>
          </div>
        </>
      }
    >
      <Text label="会社名" value={v.名前} onChange={set('名前')} placeholder="◯◯債権回収株式会社" />
      <Text label="メモ" value={v.メモ} onChange={set('メモ')} placeholder="担当者、連絡先など（任意）" />
      <Err>{err}</Err>
    </Modal>
  );
}
