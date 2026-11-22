import { useEffect, useState } from 'react';
import { api, yen, norm } from '../api';
import { Err } from '../components/ui';
import { 割合, 七割五分 } from './kaimodoshi';
import Invoice from './Invoice';

// 計算。顧客を1人選ぶと、買戻し金額と将来利益を出す。
//
//   買戻し金額 ＝（契約金額 − 支払済金額）× 75%   … 未払い残債に75%をかける
//   将来利益   ＝ 契約金額 − 契約金額の75%
//
// 75% は決まった割合（kaimodoshi.js）。画面にも書いて、何をかけたかが見えるようにする。
//
// 選んだ顧客の請求書もここから作る（Invoice.jsx）。
// 未払い顧客タブの「請求書」から来たときは、その顧客を選んだ状態で請求書を開く。
export default function Calc({ 初めの顧客id, 請求書で開く }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [key, setKey] = useState('');
  const [選んだ, set選んだ] = useState(null);   // 一覧の行
  const [中身, set中身] = useState(null);       // /api/customer の顧客
  const [読み込み中, set読み込み中] = useState(false);
  const [詳しく, set詳しく] = useState(null);   // 支払予定と入金（請求書で使う）
  const [発行者, set発行者] = useState(null);
  const [請求書, set請求書] = useState(false);

  useEffect(() => {
    api.customers()
      .then((d) => {
        setRows(d.顧客);
        // 未払い顧客タブから来たときは、その顧客を選んでおく
        if (初めの顧客id) {
          const r = d.顧客.find((x) => x.id === 初めの顧客id);
          if (r) { set選んだ(r); set請求書(!!請求書で開く); }
        }
      })
      .catch((e) => { setRows([]); setErr(e.message); });
    api.companies()
      .then((d) => set発行者(d.請求書の発行者 || null))
      .catch(() => set発行者(null));
  }, [初めの顧客id, 請求書で開く]);

  // 選んだ顧客の、総支払金額と支払った総額を取りにいく。
  // 一覧の返事には総支払金額が無いので、顧客ページと同じ中身を使う
  useEffect(() => {
    if (!選んだ) { set中身(null); return; }
    let 生きている = true;
    set読み込み中(true);
    set中身(null);
    set詳しく(null);
    api.customer(選んだ.id)
      .then((d) => {
        if (!生きている) return;
        set中身(d.顧客);
        set詳しく({ 支払予定: d.支払予定 || [], 入金: d.入金 || [] });
      })
      .catch((e) => { if (生きている) setErr(e.message); })
      .finally(() => { if (生きている) set読み込み中(false); });
    return () => { 生きている = false; };
  }, [選んだ]);

  const k = norm(key);
  const 候補 = (rows || []).filter((r) => !k
    || norm(r.氏名).includes(k) || norm(r.よみ).includes(k) || norm(r.車種).includes(k));

  if (請求書 && 中身 && 詳しく) {
    return (
      <Invoice c={中身} 支払予定={詳しく.支払予定} 入金={詳しく.入金}
               発行者={発行者} onClose={() => set請求書(false)} />
    );
  }

  return (
    <>
      <div className="bar">
        <h2>計算</h2>
        <span className="sub">顧客を選ぶと、買戻し金額と将来利益を出します</span>
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
            <結果 c={中身} 請求書を作る={() => set請求書(true)} />
          )}
        </div>
      </div>
    </>
  );
}

function 結果({ c, 請求書を作る }) {
  const 契約金額 = Number(c.支払総額) || 0;
  const 支払済 = Number(c.入金合計) || 0;
  // 将来利益は、契約金額の75%を引いた残り
  const 掛けた = 七割五分(契約金額);
  const 将来利益 = 契約金額 - 掛けた;
  // 買戻し金額は、**まだ払われていない残債**に75%をかける
  const 残債 = Math.max(0, 契約金額 - 支払済);
  const 買戻し = 七割五分(残債);
  // 買い戻す先。債権譲渡先が登録されていればその名前を出す
  const 先 = c.債権譲渡先 ? `${c.債権譲渡先}への` : '';

  return (
    <>
      <h3 className="calc-name">{c.氏名}</h3>

      <div className="calc-r">
        <h4>買戻し金額</h4>
        <div className="calc-f">（契約金額 − 支払済金額）× 買戻し率</div>
        <table className="calc-t">
          <tbody>
            <tr><th>契約金額</th><td>{yen(契約金額)}円</td></tr>
            <tr><th>お客様の支払済金額</th><td>{yen(支払済)}円</td></tr>
            <tr><th>未払い残債</th><td>{yen(残債)}円</td></tr>
            <tr><th>買戻し率</th><td>{割合}%</td></tr>
          </tbody>
        </table>
        <i>{先}買戻し金額</i>
        <div className="calc-a" data-k="買戻し金額">{yen(買戻し)}円</div>
        <div className="calc-f">{yen(残債)}円 × {割合}% ＝ {yen(買戻し)}円</div>
      </div>

      <div className="calc-r">
        <h4>将来利益</h4>
        <div className="calc-f">
          {yen(契約金額)}円 − {yen(掛けた)}円 ＝
        </div>
        <div className="calc-a" data-k="将来利益">{yen(将来利益)}円</div>
        <i>契約金額 − 契約金額の{割合}%</i>
      </div>

      <p className="calc-foot">
        円未満は切り捨てています。契約金額は総支払金額（ボーナス払いを含む）、
        支払済金額は支払いの記録に充てた入金の合計です。
      </p>

      <div className="calc-inv">
        <button className="btn btn-main" onClick={請求書を作る}>この方の請求書を作る</button>
        <span>宛先はお客様。発行者は設定タブの「請求書の発行者」です</span>
      </div>
    </>
  );
}
