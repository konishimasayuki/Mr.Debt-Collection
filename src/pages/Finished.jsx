import { useEffect, useState } from 'react';
import { api, yen, ymd, jpDate, norm } from '../api';
import { Err, Empty, Note, Loading } from '../components/ui';

// 終わった取引だけを並べる。
// 車両を回収した方（朱色）と、払い終わった方（薄い黄色）を色で分ける。
// 顧客一覧にも残っているが、そちらでは薄いグレーにして目立たせない。
export default function Finished({ onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [key, setKey] = useState('');

  useEffect(() => {
    api.customers({ 終了: 1 })
      .then((d) => setRows(d.顧客))
      .catch((e) => { setRows([]); setErr(e.message); });
  }, []);

  const k = norm(key);
  const shown = (rows || []).filter((r) => !k
    || norm(r.氏名).includes(k) || norm(r.よみ).includes(k) || norm(r.車種).includes(k));
  const 回収 = shown.filter((r) => r.終了理由 === '回収');
  const 完済 = shown.filter((r) => r.終了理由 === '完済');

  return (
    <>
      <div className="bar">
        <h2>終了</h2>
        {rows && (
          <span className="sub">
            回収 {rows.filter((r) => r.終了理由 === '回収').length}名 ／
            完済 {rows.filter((r) => r.終了理由 === '完済').length}名
          </span>
        )}
        <div className="bar-right">
          <input className="search" placeholder="氏名・よみ・車種で検索"
                 value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
      </div>

      <Note>
        取引が終わった顧客です。<span className="tag t-taken">回収</span> は車両を回収した方、
        <span className="tag t-done">完済</span> は払い終わった方。
        どちらも<b>未入金タブには出ず、督促の対象になりません</b>。
      </Note>
      <Err>{err}</Err>

      <div className="card tw cards">
        <table>
          <thead>
            <tr>
              <th>顧客名</th>
              <th>区分</th>
              <th>車種</th>
              <th className="num">月額</th>
              <th className="num">支払い回数</th>
              <th className="num">残債</th>
              <th>終わった日</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={8}><Loading 件数={3} /></td></tr>}
            {rows && shown.length === 0 && (
              <tr><td colSpan={8}><Empty>
                {rows.length ? '見つかりませんでした。' : '終わった取引はまだありません。'}
              </Empty></td></tr>
            )}
            {[...回収, ...完済].map((r) => (
              <tr key={r.id}
                  className={'clickable ' + (r.終了理由 === '回収' ? 'taken-row' : 'done-row')}
                  onClick={() => onOpen(r.id)}>
                <td className="nm">
                  <b>{r.氏名}</b>
                  {r.テスト && <span className="tag t-test">テスト</span>}
                  {r.よみ && <span className="yomi">{r.よみ}</span>}
                </td>
                <td data-label="区分">
                  <span className={'tag ' + (r.終了理由 === '回収' ? 't-taken' : 't-done')}>
                    {r.終了理由 === '回収' ? '回収' : '完済'}
                  </span>
                </td>
                <td data-label="車種">{r.車種 || <span className="none">—</span>}</td>
                <td className="num" data-label="月額">{yen(r.金額)}円</td>
                <td className="num" data-label="支払い回数">{r.支払い回数}回 / 全{r.支払い回数 + r.残り支払い回数}回</td>
                <td className="num strong" data-label="残債">{yen(r.残債金額)}円</td>
                <td data-label="終わった日">
                  {r.終了理由 === '回収'
                    ? (r.状態日 ? jpDate(r.状態日) : <span className="none">—</span>)
                    : <span className="none">—</span>}
                </td>
                <td className="act">
                  <button className="btn btn-sm"
                          onClick={(e) => { e.stopPropagation(); onOpen(r.id); }}
                  >顧客ページを開く</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
