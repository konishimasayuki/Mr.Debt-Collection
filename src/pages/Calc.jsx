import { useEffect, useState } from 'react';
import { api, yen, norm } from '../api';
import { Err, Note } from '../components/ui';

// 計算。顧客を1人選ぶと、将来利益と買い戻し金額を出す。
//
//   総支払金額 − 総支払金額の75% ＝ 将来利益
//   総支払金額の75% − その顧客が支払った総額 ＝ 買い戻し金額
//
// 75% は決まった割合。画面にも書いて、何をかけたかが見えるようにする。
// 円未満は切り捨てる（75%をかけると端数が出ることがあるため）。
export const 割合 = 75;
export const 七割五分 = (総額) => Math.floor((Number(総額) || 0) * 割合 / 100);

export default function Calc() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [key, setKey] = useState('');
  const [選んだ, set選んだ] = useState(null);   // 一覧の行
  const [中身, set中身] = useState(null);       // /api/customer の顧客
  const [読み込み中, set読み込み中] = useState(false);

  useEffect(() => {
    api.customers()
      .then((d) => setRows(d.顧客))
      .catch((e) => { setRows([]); setErr(e.message); });
  }, []);

  // 選んだ顧客の、総支払金額と支払った総額を取りにいく。
  // 一覧の返事には総支払金額が無いので、顧客ページと同じ中身を使う
  useEffect(() => {
    if (!選んだ) { set中身(null); return; }
    let 生きている = true;
    set読み込み中(true);
    set中身(null);
    api.customer(選んだ.id)
      .then((d) => { if (生きている) set中身(d.顧客); })
      .catch((e) => { if (生きている) setErr(e.message); })
      .finally(() => { if (生きている) set読み込み中(false); });
    return () => { 生きている = false; };
  }, [選んだ]);

  const k = norm(key);
  const 候補 = (rows || []).filter((r) => !k
    || norm(r.氏名).includes(k) || norm(r.よみ).includes(k) || norm(r.車種).includes(k));

  return (
    <>
      <div className="bar">
        <h2>計算</h2>
        <span className="sub">顧客を選ぶと、将来利益と買い戻し金額を出します</span>
      </div>
      {err && <Err>{err}</Err>}

      <div className="calc">
        {/* 左：顧客を選ぶ */}
        <div className="card calc-pick">
          <input className="search" placeholder="氏名・よみ・車種で検索"
                 value={key} onChange={(e) => setKey(e.target.value)} />
          <div className="calc-list">
            {rows === null && <div className="calc-none">読み込んでいます…</div>}
            {rows !== null && 候補.length === 0 && (
              <div className="calc-none">当てはまる顧客がいません</div>
            )}
            {候補.map((r) => (
              <button type="button" key={r.id}
                      className={'calc-c' + (選んだ && 選んだ.id === r.id ? ' on' : '')}
                      onClick={() => set選んだ(r)}>
                <b>{r.氏名}</b>
                {r.テスト && <span className="tag t-test">テスト</span>}
                {r.終了理由 && (
                  <span className={'tag ' + (r.終了理由 === '引き上げ' ? 't-taken' : 't-done')}>
                    {r.終了理由}
                  </span>
                )}
                {r.よみ && <i>{r.よみ}</i>}
              </button>
            ))}
          </div>
        </div>

        {/* 右：計算の結果 */}
        <div className="card calc-out">
          {!選んだ ? (
            <div className="calc-none">左から顧客を選んでください</div>
          ) : 読み込み中 || !中身 ? (
            <div className="calc-none">読み込んでいます…</div>
          ) : (
            <結果 c={中身} />
          )}
        </div>
      </div>
    </>
  );
}

function 結果({ c }) {
  const 総額 = Number(c.支払総額) || 0;
  const 掛けた = 七割五分(総額);
  const 将来利益 = 総額 - 掛けた;
  const 支払った = Number(c.入金合計) || 0;
  const 買い戻し = 掛けた - 支払った;

  return (
    <>
      <h3 className="calc-name">{c.氏名}</h3>

      <table className="calc-t">
        <tbody>
          <tr><th>総支払金額</th><td>{yen(総額)}円</td></tr>
          <tr><th>総支払金額の{割合}%</th><td>{yen(掛けた)}円</td></tr>
          <tr><th>支払った総額</th><td>{yen(支払った)}円</td></tr>
        </tbody>
      </table>

      <div className="calc-r">
        <h4>将来利益</h4>
        <div className="calc-f">
          {yen(総額)}円 − {yen(掛けた)}円 ＝
        </div>
        <div className="calc-a" data-k="将来利益">{yen(将来利益)}円</div>
        <i>総支払金額 − 総支払金額の{割合}%</i>
      </div>

      <div className="calc-r">
        <h4>買い戻し金額</h4>
        <div className="calc-f">
          {yen(掛けた)}円 − {yen(支払った)}円 ＝
        </div>
        <div className={'calc-a' + (買い戻し < 0 ? ' minus' : '')} data-k="買い戻し金額">
          {買い戻し < 0 ? '−' : ''}{yen(Math.abs(買い戻し))}円
        </div>
        <i>総支払金額の{割合}% − 支払った総額</i>
        {買い戻し < 0 && (
          <Note kind="warn">
            支払った総額が、総支払金額の{割合}%を超えています。
            計算のとおりマイナスで出しています。
          </Note>
        )}
      </div>

      <p className="calc-foot">
        円未満は切り捨てています。支払った総額は、支払いの記録に充てた入金の合計です。
      </p>
    </>
  );
}
