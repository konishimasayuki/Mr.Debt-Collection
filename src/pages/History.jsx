import { useCallback, useEffect, useState } from 'react';
import { api, yen, ymd } from '../api';
import { Modal, Text, Money, Select, Err, Empty, Note, Loading } from '../components/ui';

export default function History({ jump, onJumped, onOpen, onChanged }) {
  const [key, setKey] = useState(jump ? jump.名前 : '');
  const [limit, setLimit] = useState(30);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);

  const load = useCallback(() => {
    setErr('');
    api.payments({ 件数: limit, 検索: key })
      .then(setD)
      .catch((e) => { setD({ 入金: [], 件数: 0, 全件: 0 }); setErr(e.message); });
  }, [key, limit]);

  // 未入金などから飛んできた検索語は、一度だけ受け取って親から消してもらう。
  // 消さないと、検索欄を空にして別のタブへ行き、戻ってきたときにまた入ってしまう。
  useEffect(() => {
    if (!jump) return;
    setKey(jump.名前);
    onJumped();
  }, [jump, onJumped]);

  // 打っている最中に何度も呼ばないよう、少し待ってから検索する
  useEffect(() => { const t = setTimeout(load, key ? 250 : 0); return () => clearTimeout(t); }, [load, key]);

  return (
    <>
      <div className="bar">
        <h2>入金履歴</h2>
        {d && (
          <span className="sub">
            新しい順に{d.件数}件{d.全件 > d.件数 && ` / 該当 ${d.全件}件`}
          </span>
        )}
        <div className="bar-right">
          <input
            className="search" value={key} onChange={(e) => setKey(e.target.value)}
            placeholder="顧客名で検索（かな・カナ・半角カナ・英字）"
          />
          {key && <button className="btn btn-sm" onClick={() => setKey('')}>クリア</button>}
          <Select
            label="" value={String(limit)} onChange={(v) => setLimit(Number(v))}
            options={[30, 100, 300].map((n) => ({ value: String(n), label: `${n}件` }))}
          />
        </div>
      </div>

      <Note>
        <span className="tag t-manual">手動</span> の行は色を変えています。
        行を押すと内容を編集できます。
      </Note>
      <Err>{err}</Err>

      <div className="card tw cards">
        <table>
          <thead>
            <tr>
              <th>日付</th><th>顧客名</th><th className="num">金額</th>
              <th>入金方法</th><th>区分</th><th>付番 / 振込人</th><th>メモ</th><th>記録者</th>
            </tr>
          </thead>
          <tbody>
            {d === null && <tr><td colSpan={8}><Loading 件数={4} /></td></tr>}
            {d && d.入金.length === 0 && (
              <tr><td colSpan={8}><Empty>
                {key ? `「${key}」に当たる入金はありません。` : '入金がまだありません。'}
              </Empty></td></tr>
            )}
            {d && d.入金.map((p) => (
              <tr key={p.id} className={'clickable' + (p.区分 === '手動' ? ' manual' : '')}
                  onClick={() => setEdit(p)}>
                <td data-label="日付">{ymd(p.日付)}</td>
                <td className="nm">
                  {p.顧客id ? (
                    <span
                      style={{ color: 'var(--indigo)', textDecoration: 'underline' }}
                      onClick={(e) => { e.stopPropagation(); onOpen(p.顧客id); }}
                    >{p.顧客名}</span>
                  ) : <span className="tag t-warn">未割当</span>}
                </td>
                <td className="num strong" data-label="金額">{yen(p.金額)}円</td>
                <td data-label="入金方法">{p.入金方法}</td>
                <td data-label="区分">
                  <span className={'tag ' + (p.区分 === '手動' ? 't-manual' : 't-csv')}>{p.区分}</span>
                </td>
                <td data-label="付番 / 振込人" style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>
                  {[p.付番, p.振込人].filter(Boolean).join(' / ') || '—'}
                </td>
                <td data-label="メモ" style={{ maxWidth: 260, whiteSpace: 'normal', fontSize: 13 }}>
                  {p.メモ || ''}
                </td>
                <td data-label="記録者" style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{p.記録者}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <EditPayment
          p={edit} onClose={() => setEdit(null)}
          onDone={() => { setEdit(null); load(); onChanged && onChanged(); }}
        />
      )}
    </>
  );
}

function EditPayment({ p, onClose, onDone }) {
  const [customers, setCustomers] = useState([]);
  const [v, setV] = useState({
    日付: p.日付, 顧客id: p.顧客id ? String(p.顧客id) : '',
    金額: p.金額, 入金方法: p.入金方法, メモ: p.メモ || '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((o) => ({ ...o, [k]: val }));

  useEffect(() => { api.customers().then((d) => setCustomers(d.顧客)).catch(() => {}); }, []);

  const save = async () => {
    setBusy(true); setErr('');
    try { await api.patchPayment({ id: p.id, ...v }); onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };

  const remove = async () => {
    if (!confirm(`${ymd(p.日付)} の入金 ${yen(p.金額)}円 を取り消します。\n`
      + '充当していた回は未入金に戻ります。よろしいですか。')) return;
    setBusy(true); setErr('');
    try { await api.deletePayment(p.id); onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Modal
      title={`入金の編集（${p.区分}）`}
      onClose={onClose}
      foot={
        <>
          <button className="btn btn-danger" onClick={remove} disabled={busy}>この入金を削除</button>
          <div className="right">
            <button className="btn" onClick={onClose}>キャンセル</button>
            <button className="btn btn-main" onClick={save} disabled={busy}>
              {busy ? '保存しています…' : '保存する'}
            </button>
          </div>
        </>
      }
    >
      {p.区分 === 'CSV' && (
        <Note>
          この入金はCSVから取り込んだものです。
          日付や金額を変更すると、通帳と食い違うことがあります。理由をメモに残してください。
        </Note>
      )}
      <div className="grid2">
        <Text label="日付" type="date" value={v.日付} onChange={set('日付')} />
        <Money label="金額" value={v.金額} onChange={set('金額')} />
      </div>
      <Select label="顧客" value={v.顧客id} onChange={set('顧客id')} placeholder="未割当のまま"
              options={customers.map((c) => ({
                value: String(c.id),
                label: `${c.氏名}${c.よみ ? `（${c.よみ}）` : ''}`,
              }))}
              hint="ほかの顧客に付け替えると、両方の記録に残ります" />
      <Select label="入金方法" value={v.入金方法} onChange={set('入金方法')}
              options={[{ value: '振込', label: '振り込み' }, { value: '現金', label: '現金' },
                        { value: 'その他', label: 'その他' }]} />
      <Text label="メモ" value={v.メモ} onChange={set('メモ')} placeholder="変更した理由" />
      {(p.付番 || p.振込人) && (
        <p style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
          もとの明細：付番 {p.付番 || '—'} ／ 振込人 {p.振込人 || '—'}
        </p>
      )}
      <Err>{err}</Err>
    </Modal>
  );
}
