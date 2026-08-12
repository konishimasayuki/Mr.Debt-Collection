import { useCallback, useEffect, useState } from 'react';
import { api, yen, ymd } from '../api';
import { Modal, Text, Money, Select, Err, Empty, Note, Loading } from '../components/ui';

export default function History({ jump, onJumped, onOpen, onChanged }) {
  const [key, setKey] = useState(jump ? jump.名前 : '');
  const [limit, setLimit] = useState(30);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [割り当て, set割り当て] = useState(null);   // 入金の種類をまとめて直す顧客

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
              <th />
            </tr>
          </thead>
          <tbody>
            {d === null && <tr><td colSpan={9}><Loading 件数={4} /></td></tr>}
            {d && d.入金.length === 0 && (
              <tr><td colSpan={9}><Empty>
                {key ? `「${key}」に当たる入金はありません。` : '入金がまだありません。'}
              </Empty></td></tr>
            )}
            {d && d.入金.map((p) => (
              <tr key={p.id} className={'clickable' + (p.区分 === '手動' ? ' manual' : '')
                    + (p.テスト ? ' test-row' : '')}
                  onClick={() => setEdit(p)}>
                <td data-label="日付">{ymd(p.日付)}</td>
                <td className="nm">
                  {p.顧客id ? (
                    <span className="lnk"
                          onClick={(e) => { e.stopPropagation(); onOpen(p.顧客id); }}
                    >{p.顧客名}</span>
                  ) : <span className="tag t-warn">未割当</span>}
                  {p.テスト && <span className="tag t-test">テスト</span>}
                </td>
                <td className="num strong" data-label="金額">{yen(p.金額)}円</td>
                <td data-label="入金方法">{p.入金方法}</td>
                <td data-label="区分">
                  <span className={'tag ' + (p.区分 === '手動' ? 't-manual' : 't-csv')}>{p.区分}</span>
                </td>
                <td data-label="付番 / 振込人" className="mono">
                  {[p.付番, p.振込人].filter(Boolean).join(' / ') || '—'}
                </td>
                <td data-label="メモ" className="memo">{p.メモ || ''}</td>
                <td data-label="記録者" className="who">{p.記録者}</td>
                <td className="act">
                  {/* 月額とボーナスの取り違えを、まとめて見比べながら直せる。
                      ボーナス払いの方にだけ出す */}
                  {p.顧客id && p.ボーナスあり && (
                    <button className="btn btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              set割り当て({ id: p.顧客id, 氏名: p.顧客名 });
                            }}>割り当て直し</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {割り当て && (
        <割り当て直し
          顧客id={割り当て.id} 顧客名={割り当て.氏名}
          onClose={() => set割り当て(null)}
          onDone={() => { set割り当て(null); load(); onChanged && onChanged(); }}
        />
      )}

      {edit && (
        <EditPayment
          p={edit} onClose={() => setEdit(null)}
          onDone={() => { setEdit(null); load(); onChanged && onChanged(); }}
        />
      )}
    </>
  );
}

// 入金の割り当て直し。
//
// 「月額のつもりの入金がボーナスに入っている」「その逆」を直す。
// 1件ずつ「直す」から入金種類を変えることもできるが、
// 同じ方の入金をまとめて見比べながら直せたほうが早い。
// 直したあとは、その顧客のお金を古い回から順に詰め直す。
function 割り当て直し({ 顧客id, 顧客名, onClose, onDone }) {
  const [d, setD] = useState(null);
  const [選び, set選び] = useState({});      // 入金id → 月額 / ボーナス
  const [メモ, setメモ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.customer(顧客id).then(setD).catch((e) => setErr(e.message));
  }, [顧客id]);

  const いま = (p) => (選び[p.id] !== undefined ? 選び[p.id] : p.入金種類);
  const 変えた = d ? d.入金.filter((p) => いま(p) !== p.入金種類) : [];

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.reassign(顧客id,
        変えた.map((p) => ({ 入金id: p.id, 入金種類: いま(p) })), メモ);
      alert(`${r.変えた件数}件の割り当てを直しました。`);
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Modal
      wide
      title={`${顧客名} さんの入金の割り当て直し`}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>キャンセル</button>
          <div className="right">
            <button className="btn btn-main" onClick={save} disabled={busy || !変えた.length}>
              {busy ? '直しています…' : `${変えた.length}件を直す`}
            </button>
          </div>
        </>
      }
    >
      <Note>
        <b>月額のつもりの入金がボーナスに入っていたときに、ここで直せます。</b>
        {' '}その逆も直せます。この方の入金をまとめて見比べられます。
        <br />
        <b>入金の金額・件数・残債は変わりません。</b>どの回に充てるかだけが変わります。
        直したあとは、古い回から順に詰め直します。
      </Note>
      <Err>{err}</Err>

      {d === null && <Loading 件数={3} 行={1} />}
      {d && d.入金.length === 0 && <Empty>まだ入金がありません。</Empty>}
      {d && !d.顧客.ボーナス回数 && (
        <Note kind="warn">この方にはボーナス払いの設定がありません。</Note>
      )}

      {d && d.入金.length > 0 && (
        <div className="ex-list">
          {d.入金.map((p) => (
            <div className="ex-row" key={p.id}>
              <b>{ymd(p.日付)}</b>
              <span className="ex-on">{yen(p.金額)}円</span>
              <span className="ex-memo">{p.振込人 || p.メモ || p.区分}</span>
              <select className="assign kind" value={いま(p)}
                      onChange={(e) => set選び((o) => ({ ...o, [p.id]: e.target.value }))}>
                <option value="月額">月額</option>
                <option value="ボーナス">ボーナス</option>
              </select>
              {いま(p) !== p.入金種類 && <span className="tag t-done">直した</span>}
            </div>
          ))}
        </div>
      )}

      {変えた.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text label="直した理由（任意）" value={メモ} onChange={setメモ}
                placeholder="例：本人に確認したところ賞与分だった"
                hint="記録に残ります" />
        </div>
      )}
    </Modal>
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
