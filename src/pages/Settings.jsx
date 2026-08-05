import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal, Text, Err, Note, Empty, Loading } from '../components/ui';

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
