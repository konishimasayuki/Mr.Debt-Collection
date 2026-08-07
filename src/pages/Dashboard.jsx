// ダッシュボード。いま何が回収できていないかを、月ごとに積み上げて見せる。
//
// 経営者が見る数字であり、担当者が朝いちばんに開く画面でもある。
// 「どの月が、どれだけ残っていて、誰に電話すればいいか」がここで分かるようにする。
//
// 決めごと
// ・期日が今日以前の回だけを数える。まだ期日の来ていない回は未回収ではない
// ・100%回収できた月は出さない。残っている月は、どれだけ古くても出し続ける
// ・車を引き上げた方と、動作を試すための顧客は入れない
import { useCallback, useEffect, useState } from 'react';
import { api, yen, ymd, md } from '../api';
import { Err, Empty, Note, Loading } from '../components/ui';

// 回収率の色。7割を切ったら赤、9割以上なら緑
const 率の色 = (n) => (n >= 90 ? 'good' : n < 70 ? 'bad' : '');

export default function Dashboard({ onOpen }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setErr('');
    api.dashboard().then(setD)
      .catch((e) => { setD({ 月: [], 約束切れ: { 合計: 0, 月別: [] } }); setErr(e.message); });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!d) {
    return (
      <>
        <div className="bar"><h2>ダッシュボード</h2></div>
        <Loading 件数={3} />
      </>
    );
  }

  const 合計 = d.合計 || { 全件: 0, 回収済み: 0, 率: 100, 未回収額: 0, 未回収人数: 0 };
  const 切れ = d.約束切れ || { 合計: 0, 月別: [] };
  // 2か月以上ためている人だけ出す。1か月は遅れ始めたところで、まだ当たり前
  const 月数別 = (合計.月数別 || []).filter((x) => x.月数 >= 2);

  return (
    <>
      <div className="bar">
        <h2>ダッシュボード</h2>
        <span className="sub">{ymd(d.本日)} 時点</span>
      </div>

      <Err>{err}</Err>

      {/* 全体の回収率。月ごとの内訳はこの下に積む */}
      <div className="dash-top">
        <div className={'dash-rate ' + 率の色(合計.率)}>
          <b>{合計.率}%</b>
          <i>{合計.回収済み}/{合計.全件} 回収</i>
        </div>
        <div className="dash-s">
          <b>{yen(合計.未回収額)}円</b>
          <i>未回収額</i>
        </div>
        <div className="dash-s">
          <b>{合計.未回収人数}名</b>
          <i>未回収の顧客</i>
          {/* 何か月ためているかの内訳。人数は重複なし（1人は1か所にだけ入る）。
              1か月だけの人は当たり前なので出さない。ためている人だけを出す */}
          {月数別.length > 0 && (
            <span className="dash-brk">
              {月数別.map((x) => (
                <em key={x.月数}>{x.月数}か月 {x.人数}人</em>
              ))}
            </span>
          )}
        </div>
      </div>

      {/* 「この日に払う」と言った日を過ぎている件数。
          ここには名前を並べない。下の月ごとの一覧と同じ人が二重に出て画面が伸びるため。
          誰なのかは、その月の一覧でその人の行に付く「◯/◯ 約束切れ」の印で分かる */}
      {切れ.合計 > 0 && (
        <div className="alert-box alert-sum">
          {/* 「約束切れが 6月分に1件、7月分に2件、合計3件あります。」
              文字をJSXで継ぎ足すと余計な空白が入るので、1つの文字列に組んでから出す */}
          <b>
            {`約束切れが ${切れ.月別.map((x) => `${x.見出し}に ${x.件数}件`).join('、')}`
              + `、合計 ${切れ.合計}件 あります。`}
          </b>
          <i>下の一覧で、その人の行に <span className="tag t-late">◯/◯ 約束切れ</span> と付いています。</i>
        </div>
      )}

      <Note>
        支払期日が過ぎた回だけを数えています。まだ期日の来ていない回は入りません。
        <b>全部回収できた月は消えます。</b>残っている月は、古くても出し続けます。
        車両を引き上げた方と、動作を試すための顧客は入れていません。
      </Note>

      {d.月.length === 0 && (
        <div className="card"><Empty>
          期日の過ぎた支払いは、すべて回収できています。
        </Empty></div>
      )}

      {d.月.map((m) => (
        <div className="sec dash-m" key={m.年月}>
          <div className="dash-h">
            <h3>{m.見出し}</h3>
            <span className={'dash-p ' + 率の色(m.率)}>{m.率}%</span>
            <span className="dash-x">{m.回収済み}/{m.全件} 回収</span>
            <span className="dash-x">未回収 <b>{yen(m.未回収額)}円</b></span>
            {m.後回し数 > 0 && <span className="dash-x">後回し {m.後回し数}件</span>}
          </div>

          <div className="dash-rows">
            {m.行.map((r) => (
              <button
                type="button"
                key={`${r.顧客id}-${r.回の種類}-${r.回次}`}
                className={'dash-r' + (r.重複 ? ' dup' : '')}
                onClick={() => onOpen(r.顧客id)}
              >
                <span className="dash-nm">
                  {r.氏名}
                  {r.回の種類 === 'ボーナス' && <span className="tag t-bonus">ボーナス</span>}
                  {/* 2か月以上ためている人は、いちばん先に電話する相手 */}
                  {r.重複 && <span className="tag t-late">{r.重なった月数}か月 未回収</span>}
                  {!r.督促回数 && <span className="tag t-warn">未督促</span>}
                </span>
                <span className="dash-amt">
                  {yen(r.料金)}円
                  {r.入金済み > 0 && <i>残り {yen(r.残り)}円</i>}
                </span>
                <span className="dash-pr">
                  {r.後回し ? (
                    r.後回し.切れ ? (
                      // 約束の日を過ぎている。何を言ったかより「破った」ことが先
                      <span className="tag t-late">
                        {md(r.後回し.日)} 約束切れ
                        {r.後回し.件数 > 1 && `（${r.後回し.件数}件）`}
                      </span>
                    ) : (
                      <span className="tag t-dup">
                        後回し
                        {r.後回し.件数 > 1 && ` 1/${r.後回し.件数}`}
                        {' '}{md(r.後回し.日)}
                        {r.後回し.時刻 ? ` ${r.後回し.時刻}まで` : ''}
                        {' '}{yen(r.後回し.金額)}円
                      </span>
                    )
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

    </>
  );
}
