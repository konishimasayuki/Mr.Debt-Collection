import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal, Text, Err, Note, Empty } from '../components/ui';

export default function Settings({ onChanged }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);

  const load = () => {
    setErr('');
    api.companies().then((d) => setRows(d.会社)).catch((e) => { setRows([]); setErr(e.message); });
  };
  useEffect(load, []);

  const toggle = async (c) => {
    try { await api.patchCompany({ id: c.id, 使う: !c.使う }); load(); onChanged && onChanged(); }
    catch (e) { setErr(e.message); }
  };

  const remove = async (c) => {
    if (!confirm(`債権会社「${c.名前}」を消します。よろしいですか。`)) return;
    try {
      const d = await api.deleteCompany(c.id);
      if (d.知らせ) alert(d.知らせ);
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
          顧客に使われている会社は消せません（「使わない」にすると、次からは選べなくなります）。
        </Note>
        <Err>{err}</Err>

        <div className="card tw">
          <table>
            <thead>
              <tr><th>会社名</th><th>メモ</th><th className="num">使用中の顧客</th>
                <th>選べる</th><th /></tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={5}><Empty>読み込んでいます…</Empty></td></tr>}
              {rows && rows.length === 0 && (
                <tr><td colSpan={5}><Empty>
                  まだ登録がありません。「債権会社を追加」から入れてください。
                </Empty></td></tr>
              )}
              {rows && rows.map((c) => (
                <tr key={c.id} className={c.使う ? '' : 'off'}>
                  <td><b>{c.名前}</b></td>
                  <td style={{ whiteSpace: 'normal', fontSize: 13 }}>{c.メモ || ''}</td>
                  <td className="num">{c.使用数}件</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => toggle(c)}>
                      {c.使う ? '選べる' : '使わない'}
                    </button>
                  </td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => setEdit(c)}>直す</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(c)}>消す</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Maintenance />

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
      title={c ? '債権会社を直す' : '債権会社を追加'}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>やめる</button>
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

// ── 保守（テーブル作成・既存データの載せ替え）─────────────
function Maintenance() {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (載せ替え) => {
    if (載せ替え && !confirm(
      '旧台帳の顧客データを、この台帳へ入れます。\n'
      + '同じ氏名の方がすでに居れば飛ばすので、二度実行しても増えません。\n\nよろしいですか。'
    )) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.setup(載せ替え ? { 載せ替え: true } : {});
      setMsg(載せ替え
        ? `追加した顧客 ${d.追加した顧客}名／すでに居た顧客 ${d.すでに居た顧客}名／`
          + `作った支払予定 ${d.作った支払予定}件。\n${d.注意 || ''}`
        : `テーブルを用意しました（${d.実行した文}件）。${d.次に || ''}`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="sec">
      <h3>保守</h3>
      <Note>
        はじめに一度だけ「テーブルを用意する」を押してください。
        そのあと「既存データを載せ替える」で、旧台帳の顧客が入ります。
      </Note>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => run(false)} disabled={busy}>テーブルを用意する</button>
        <button className="btn" onClick={() => run(true)} disabled={busy}>既存データを載せ替える</button>
      </div>
      {msg && <Note kind="ok"><span style={{ whiteSpace: 'pre-wrap' }}>{msg}</span></Note>}
      <Err>{err}</Err>
    </div>
  );
}
