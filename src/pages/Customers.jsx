import { useEffect, useState } from 'react';
import { api, yen, ymd, norm } from '../api';
import { Modal, Text, Money, Select, Err, Empty, Note } from '../components/ui';

export default function Customers({ onOpen, onChanged }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');

  const load = () => {
    setErr('');
    api.customers().then((d) => setRows(d.顧客)).catch((e) => { setRows([]); setErr(e.message); });
  };
  useEffect(load, []);

  const k = norm(key);
  const shown = (rows || []).filter((r) => !k
    || norm(r.氏名).includes(k) || norm(r.よみ).includes(k) || norm(r.車種).includes(k));

  return (
    <>
      <div className="bar">
        <h2>顧客一覧</h2>
        <div className="bar-right">
          <input
            className="search" placeholder="氏名・よみ・車種で検索"
            value={key} onChange={(e) => setKey(e.target.value)}
          />
          <button className="btn btn-main" onClick={() => setOpen(true)}>＋ 新規顧客登録</button>
        </div>
      </div>

      <Err>{err}</Err>

      <div className="card tw">
        <table>
          <thead>
            <tr>
              <th>氏名</th>
              <th>債権譲渡会社</th>
              <th>車種</th>
              <th className="num">毎月の支払日</th>
              <th className="num">金額</th>
              <th className="num">残り支払い回数</th>
              <th className="num">残債金額</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={7}><Empty>読み込んでいます…</Empty></td></tr>}
            {rows && shown.length === 0 && (
              <tr><td colSpan={7}><Empty>
                {rows.length ? '見つかりませんでした。' : '顧客がまだ登録されていません。'}
              </Empty></td></tr>
            )}
            {shown.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => onOpen(r.id)}>
                <td>
                  <b>{r.氏名}</b>
                  {r.よみ && <span className="sub" style={{ marginLeft: 8, color: 'var(--ink-3)', fontSize: 12 }}>{r.よみ}</span>}
                </td>
                <td>{r.債権譲渡会社 || <span style={{ color: 'var(--ink-3)' }}>—</span>}</td>
                <td>{r.車種 || <span style={{ color: 'var(--ink-3)' }}>—</span>}</td>
                <td className="num">{r.毎月の支払日}日</td>
                <td className="num">{yen(r.金額)}</td>
                <td className="num">{r.残り支払い回数}回</td>
                <td className="num">{yen(r.残債金額)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <NewCustomer
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); load(); onChanged && onChanged(); }}
        />
      )}
    </>
  );
}

// ── 新規顧客登録 ───────────────────────────
const 空 = {
  名前: '', よみ: '', 性別: '', 生年月日: '', 住所: '', 電話番号: '',
  契約日: '', 車種: '', 債権譲渡会社: '', 債権譲渡先: '',
  月々の金額: '', 回数: 48, 支払日: 27, 開始月: '', メモ: '',
};

function NewCustomer({ onClose, onDone }) {
  const [v, setV] = useState(空);
  const [companies, setCompanies] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((o) => ({ ...o, [k]: val }));

  useEffect(() => {
    api.companies()
      .then((d) => setCompanies(d.会社))
      .catch(() => setCompanies([]));
  }, []);

  const opts = companies.map((c) => ({ value: String(c.id), label: c.名前 }));

  // 開始月の既定は契約日の翌月
  const 既定開始 = (() => {
    if (v.開始月) return v.開始月;
    const base = v.契約日 ? new Date(v.契約日) : new Date();
    if (isNaN(base)) return '';
    const t = base.getFullYear() * 12 + base.getMonth() + 1;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
  })();

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const d = await api.addCustomer({ ...v, 開始月: 既定開始 });
      let msg = `${d.氏名}さんを登録しました。\n${d.初回} から ${d.最終回} まで、全${v.回数}回。`;
      if (d.同姓同名) msg += `\n\n※ 同じお名前の方が ${d.同姓同名}名 になりました。ご確認ください。`;
      alert(msg);
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title="新規顧客登録"
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>キャンセル</button>
          <div className="right">
            <button className="btn btn-main" onClick={submit} disabled={busy}>
              {busy ? '登録しています…' : '登録する'}
            </button>
          </div>
        </>
      }
    >
      <div className="grid2">
        <Text label="名前" value={v.名前} onChange={set('名前')} placeholder="山田 太郎" />
        <Text label="よみ（カナ）" value={v.よみ} onChange={set('よみ')}
              placeholder="ヤマダ タロウ" hint="あいうえお順と、CSVの振込人名の照合に使います" />
      </div>
      <div className="grid3">
        <Select label="性別" value={v.性別} onChange={set('性別')} placeholder="選択しない"
                options={[{ value: '男性', label: '男性' }, { value: '女性', label: '女性' },
                          { value: 'その他', label: 'その他' }]} />
        <Text label="生年月日" type="date" value={v.生年月日} onChange={set('生年月日')} />
        <Text label="電話番号" value={v.電話番号} onChange={set('電話番号')} placeholder="090-0000-0000" />
      </div>
      <Text label="住所" value={v.住所} onChange={set('住所')} />
      <div className="grid2">
        <Text label="契約日" type="date" value={v.契約日} onChange={set('契約日')} />
        <Text label="車種" value={v.車種} onChange={set('車種')} placeholder="タントカスタム" />
      </div>
      <div className="grid2">
        <Select label="債権譲渡会社" value={v.債権譲渡会社} onChange={set('債権譲渡会社')}
                placeholder={opts.length ? '選択しない' : '設定タブで登録してください'}
                options={opts} disabled={!opts.length} />
        <Select label="債権譲渡先" value={v.債権譲渡先} onChange={set('債権譲渡先')}
                placeholder={opts.length ? '選択しない' : '設定タブで登録してください'}
                options={opts} disabled={!opts.length} />
      </div>
      <div className="grid3">
        <Money label="月々の金額" value={v.月々の金額} onChange={set('月々の金額')} placeholder="30,000" />
        <Text label="支払回数" type="number" min="1" value={v.回数}
              onChange={(x) => set('回数')(Number(x) || '')} />
        <Text label="毎月の支払日" type="number" min="1" max="31" value={v.支払日}
              onChange={(x) => set('支払日')(Number(x) || '')}
              hint="その月に無い日は末日にします" />
      </div>
      <Text label="支払い開始月" type="month" value={既定開始} onChange={set('開始月')}
            hint="空のままなら契約日の翌月から始めます" />
      <Text label="メモ" value={v.メモ} onChange={set('メモ')} />

      {v.月々の金額 > 0 && v.回数 > 0 && (
        <Note kind="ok">
          支払総額 <b>{yen(v.月々の金額 * v.回数)}円</b>（月々 {yen(v.月々の金額)}円 × {v.回数}回）
          {既定開始 && ` ／ ${ymd(既定開始)} から`}
        </Note>
      )}
      <Err>{err}</Err>
    </Modal>
  );
}
