import { useEffect, useState } from 'react';
import { api, yen } from '../api';
import { Modal, Text, Err, Note, Empty } from '../components/ui';

export default function Settings({ onChanged }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [ver, setVer] = useState(0);

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

      <Maintenance onDone={() => { setVer((n) => n + 1); load(); onChanged && onChanged(); }} />
      {/* 載せ替えのあとに顧客が増えるので、読み直せるよう ver で作り直す */}
      <Opening key={ver} onChanged={onChanged} />

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

// ── 開始時の入金実績 ─────────────────────────
// 載せ替えただけでは全員が1回目から未入金に見える。
// 通帳を見ながら「何回目まで済んでいるか」を入れる。
function Opening({ onChanged }) {
  const [rows, setRows] = useState(null);
  const [v, setV] = useState({});          // 顧客id → 入力中の回数
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setErr('');
    api.opening().then((d) => {
      setRows(d.顧客);
      const init = {};
      d.顧客.forEach((c) => (init[c.id] = String(c.開始時に入れた回数 || '')));
      setV(init);
    }).catch((e) => { setRows([]); setErr(e.message); });
  };
  useEffect(load, []);

  // 中身を変えた行だけ送る
  const 変えた = (rows || []).filter(
    (c) => String(v[c.id] ?? '') !== String(c.開始時に入れた回数 || ''));

  const save = async () => {
    if (!変えた.length) return;
    if (!confirm(`${変えた.length}名ぶんの開始時の入金実績を入れます。\n`
      + '入れ直すと、前に入れた開始時の入金は置き換わります。\n\nよろしいですか。')) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.putOpening({
        一括: 変えた.map((c) => ({ 顧客id: c.id, 回数: Number(v[c.id] || 0) })),
      });
      setMsg(`${d.入れた人数}名に入れました（合計 ${yen(d.足した金額)}円）。`
        + (d.入らなかった分 ? `\n入らなかった分：${d.入らなかった分.map((x) => x.氏名 || x.顧客id).join('、')}` : ''));
      load(); onChanged && onChanged();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="sec">
      <h3>開始時の入金実績</h3>
      <Note>
        旧台帳から載せ替えただけでは、全員が1回目から未入金に見えます。
        通帳を見ながら、<b>何回目まで入金が済んでいるか</b>を入れてください。
        「期日到来」は今日までに期日が来た回数で、入力の目安です（確定値ではありません）。
        入れ直すと前の分は置き換わります。
      </Note>
      {msg && <Note kind="ok">{msg}</Note>}
      <Err>{err}</Err>

      <div className="bar" style={{ marginTop: 0 }}>
        <span className="sub">
          {rows ? `${rows.length}名` : ''}{変えた.length ? ` ／ ${変えた.length}名を変更中` : ''}
        </span>
        <div className="bar-right">
          <button className="btn btn-main" onClick={save} disabled={busy || !変えた.length}>
            {busy ? '入れています…' : `${変えた.length}名ぶんを入れる`}
          </button>
        </div>
      </div>

      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>氏名</th><th className="num">月額</th><th className="num">全回数</th>
              <th className="num">期日到来</th><th className="num">いま入金済み</th>
              <th className="num">何回目まで済んでいるか</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={6}><Empty>読み込んでいます…</Empty></td></tr>}
            {rows && rows.length === 0 && (
              <tr><td colSpan={6}><Empty>
                顧客がまだ登録されていません。先に「既存データを載せ替える」を押してください。
              </Empty></td></tr>
            )}
            {rows && rows.map((c) => (
              <tr key={c.id} className={String(v[c.id] ?? '') !== String(c.開始時に入れた回数 || '') ? 'manual' : ''}>
                <td><b>{c.氏名}</b>
                  {c.よみ && <span style={{ marginLeft: 8, color: 'var(--ink-3)', fontSize: 12 }}>{c.よみ}</span>}
                </td>
                <td className="num">{yen(c.月々の金額)}</td>
                <td className="num">{c.回数}回</td>
                <td className="num" style={{ color: 'var(--ink-2)' }}>{c.期日到来}回</td>
                <td className="num">{c.入金済み}回</td>
                <td className="num">
                  <input
                    className="num-in" type="number" min="0" max={c.回数}
                    value={v[c.id] ?? ''}
                    onChange={(e) => setV((o) => ({ ...o, [c.id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
function Maintenance({ onDone }) {
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
      // 旧台帳のテーブルを別の置き場へ移したときは、必ず伝える（消していないこと）
      const 退避 = d.退避した旧テーブル?.length
        ? `\n旧台帳のテーブル ${d.退避した旧テーブル.length}件（${d.退避した旧テーブル.join('、')}）を`
          + ` old_ledger へ移しました。消していません。`
        : '';
      setMsg((載せ替え
        ? `追加した顧客 ${d.追加した顧客}名／すでに居た顧客 ${d.すでに居た顧客}名／`
          + `作った支払予定 ${d.作った支払予定}件。\n${d.注意 || ''}`
        : `テーブルを用意しました（${d.実行した文}件）。${d.次に || ''}`) + 退避);
      onDone && onDone();
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
