import { useCallback, useEffect, useState } from 'react';
import { api, yen, ymd } from '../api';
import { Err, Empty, Note, Loading } from '../components/ui';
import { ManualPayment } from './PaymentEntry';

export default function Unpaid({ onOpen, goHistory, onChanged }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [入金する, set入金する] = useState(null);   // 手動入金を入れる顧客

  const load = useCallback(() => {
    api.customers({ 未入金: 1 })
      .then((d) => setRows(d.顧客))
      .catch((e) => { setRows([]); setErr(e.message); });
  }, []);
  useEffect(load, [load]);

  // 合計には、動作を試すための顧客を入れない。
  // 経営者が見る数字なので、試し打ちの金額が混ざってはいけない。
  const 本物 = (rows || []).filter((r) => !r.テスト);
  const テスト数 = (rows || []).length - 本物.length;
  const 合計 = 本物.reduce((s, r) => s + r.この回の残り, 0);

  return (
    <>
      <div className="bar">
        <h2>未入金</h2>
        {rows && (
          <span className="sub">
            {本物.length}名 ／ 今の回の未入金 合計 {yen(合計)}円
          </span>
        )}
      </div>

      <Note>
        支払期日までに入金できていない顧客を、あいうえお順で出しています。
        行を押すと、入金履歴でその方を探した状態になります。
        {テスト数 > 0 && (
          <> なお、<span className="tag t-test">テスト</span> の
          {テスト数}名は上の人数と合計に入れていません。</>
        )}
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
            {rows === null && <tr><td colSpan={8}><Loading 件数={3} /></td></tr>}
            {rows && rows.length === 0 && (
              <tr><td colSpan={8}><Empty>
                期日を過ぎて未入金の顧客はいません。
              </Empty></td></tr>
            )}
            {rows && rows.map((r) => (
              <tr key={r.id} className={'clickable' + (r.テスト ? ' test-row' : '')}
                  onClick={() => goHistory(r.氏名)}>
                <td className="nm">
                  <b>{r.氏名}</b>
                  {r.テスト && <span className="tag t-test">テスト</span>}
                  {r.よみ && <span className="yomi">{r.よみ}</span>}
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
                <td className="act">
                  <button
                    className="btn btn-sm"
                    onClick={(e) => { e.stopPropagation(); onOpen(r.id); }}
                  >顧客ページを開く</button>
                  {/* 電話中にその場で入金を入れられるように。
                      入金登録タブへ行って名前を探し直さなくて済む */}
                  <button
                    className="btn btn-sm btn-main"
                    onClick={(e) => { e.stopPropagation(); set入金する(r); }}
                  >手動入金登録</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {入金する && (
        <ManualPayment
          初期顧客id={入金する.id}
          onClose={() => set入金する(null)}
          onDone={() => { set入金する(null); load(); onChanged && onChanged(); }}
        />
      )}
    </>
  );
}
