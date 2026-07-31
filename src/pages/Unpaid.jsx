import { useEffect, useState } from 'react';
import { api, yen, ymd } from '../api';
import { Err, Empty, Note } from '../components/ui';

export default function Unpaid({ onOpen, goHistory }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.customers({ 未入金: 1 })
      .then((d) => setRows(d.顧客))
      .catch((e) => { setRows([]); setErr(e.message); });
  }, []);

  const 合計 = (rows || []).reduce((s, r) => s + r.この回の残り, 0);

  return (
    <>
      <div className="bar">
        <h2>未入金</h2>
        {rows && (
          <span className="sub">
            {rows.length}名 ／ 今の回の未入金 合計 {yen(合計)}円
          </span>
        )}
      </div>

      <Note>
        支払期日までに入金できていない顧客を、あいうえお順で出しています。
        行を押すと、入金履歴でその方を探した状態になります。
      </Note>
      <Err>{err}</Err>

      <div className="card tw cards">
        <table>
          <thead>
            <tr>
              <th>顧客名</th>
              <th className="num">月額</th>
              <th>支払い期日</th>
              <th className="num">支払日</th>
              <th className="num">支払い回数</th>
              <th className="num">残回数</th>
              <th className="num">残債</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={8}><Empty>読み込んでいます…</Empty></td></tr>}
            {rows && rows.length === 0 && (
              <tr><td colSpan={8}><Empty>
                期日を過ぎて未入金の顧客はいません。
              </Empty></td></tr>
            )}
            {rows && rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => goHistory(r.氏名)}>
                <td>
                  <b>{r.氏名}</b>
                  {r.よみ && (
                    <span style={{ marginLeft: 8, color: 'var(--ink-3)', fontSize: 12 }}>{r.よみ}</span>
                  )}
                  <span className="tag t-late" style={{ marginLeft: 8 }}>{r.遅れ日数}日 遅れ</span>
                  {r.この回の残り !== r.金額 && (
                    <span className="tag t-dup" style={{ marginLeft: 6 }}>
                      残り {yen(r.この回の残り)}円
                    </span>
                  )}
                </td>
                <td className="num" data-label="月額">{yen(r.金額)}</td>
                <td data-label="支払い期日">{ymd(r.支払い期日)}</td>
                <td className="num" data-label="支払日">{r.毎月の支払日}日</td>
                <td className="num" data-label="支払い回数">{r.支払い回数}回</td>
                <td className="num" data-label="残回数">{r.残り支払い回数}回</td>
                <td className="num" data-label="残債">{yen(r.残債金額)}</td>
                <td>
                  <button
                    className="btn btn-sm"
                    onClick={(e) => { e.stopPropagation(); onOpen(r.id); }}
                  >顧客ページ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
