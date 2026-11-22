import { useEffect, useState } from 'react';
import { api, yen, jpDate, norm } from '../api';
import { Err, Empty, Loading } from '../components/ui';

// 未払い顧客。エンジンストップの方と、払われていない月がある方を、まとめて見る。
//
//   エンジンストップ → 1か月分 → 2か月分 → 3か月分以上
//
// の順に欄を分ける。エンジンストップの方は滞納の月数にかかわらず、いちばん上の欄だけに出す
//（同じ人が2か所に出ないように）。
//
// 「か月分」は、期日を過ぎてまだ払われていない**月額の回の数**。
// 未払い額は、期日を過ぎた回の残りの合計（ボーナスの回も入る）。
//
// ここは請求書を出す場所ではない（請求書は計算タブから）。
// のちに、各行からLINEで定型文を送るボタンを置く予定（送り方は相談中）。
const 欄の順 = ['エンジンストップ', '1か月分', '2か月分', '3か月分以上'];
const 欄の説明 = {
  エンジンストップ: '車を止めている方。取引は続いています',
  '1か月分': '1回ぶん払われていない方',
  '2か月分': '2回ぶん払われていない方',
  '3か月分以上': '3回ぶん以上たまっている方',
};

export default function Arrears({ onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [key, setKey] = useState('');

  useEffect(() => {
    api.customers({ 未払い顧客: 1 })
      .then((d) => setRows(d.顧客))
      .catch((e) => { setRows([]); setErr(e.message); });
  }, []);

  const k = norm(key);
  const shown = (rows || []).filter((r) => !k
    || norm(r.氏名).includes(k) || norm(r.よみ).includes(k) || norm(r.車種).includes(k));
  // 本物の顧客だけで合計する（動作を試すための顧客は数字に混ぜない）
  const 本物 = (rows || []).filter((r) => !r.テスト);
  const 合計 = 本物.reduce((a, r) => a + r.未払い額, 0);

  return (
    <>
      <div className="bar">
        <h2>未払い顧客</h2>
        {rows && (
          <span className="sub">
            {本物.length}名 ／ 未払い額 合計 <b>{yen(合計)}円</b>
          </span>
        )}
        <div className="bar-right">
          <input className="search" placeholder="氏名・よみ・車種で検索"
                 value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
      </div>
      <Err>{err}</Err>

      {rows === null && <Loading 件数={4} />}
      {rows && rows.length === 0 && <Empty>未払いの方はいません。</Empty>}

      {rows && 欄の順.map((区) => {
        const 人 = shown.filter((r) => r.区分 === 区);
        if (!人.length) return null;
        const 小計 = 人.filter((r) => !r.テスト).reduce((a, r) => a + r.未払い額, 0);
        return (
          <div className={'arr-sec arr-' + (区 === 'エンジンストップ' ? 'eng' : 'm')} key={区}
               data-k={区}>
            <div className="arr-h">
              <h3>{区}</h3>
              <span>{人.length}名 ／ 未払い額 {yen(小計)}円</span>
              <i>{欄の説明[区]}</i>
            </div>
            <div className="card tw cards">
              <table>
                <thead>
                  <tr>
                    <th>お客様名</th>
                    <th className="num">未払い額</th>
                    <th>車両</th>
                    <th className="num">残債額</th>
                    <th>遅れ</th>
                  </tr>
                </thead>
                <tbody>
                  {人.map((r) => (
                    <tr key={r.id} className={'clickable' + (r.テスト ? ' test-row' : '')}
                        onClick={() => onOpen(r.id)}>
                      <td className="nm">
                        <b>{r.氏名}</b>
                        {r.テスト && <span className="tag t-test">テスト</span>}
                        {r.ボーナス滞納 && <span className="tag t-bonus">ボーナス</span>}
                        {r.よみ && <span className="yomi">{r.よみ}</span>}
                      </td>
                      <td className="num strong" data-label="未払い額">{yen(r.未払い額)}円</td>
                      <td data-label="車両">{r.車種 || <span className="none">—</span>}</td>
                      <td className="num" data-label="残債額">{yen(r.残債金額)}円</td>
                      <td data-label="遅れ">
                        {r.遅れ日数 > 0 ? (
                          <>
                            <span className="tag t-late">{r.滞納月数}か月分・{r.遅れ日数}日</span>
                            <span className="arr-d">{jpDate(r.いちばん古い期日)}から</span>
                          </>
                        ) : <span className="none">遅れなし</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}
