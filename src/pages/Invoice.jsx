import { useState } from 'react';
import { yen, jpDate, 本日 } from '../api';
import { 割合, 七割五分 } from './kaimodoshi';

// 請求書。計算タブで顧客を選び「請求書を作る」を押すと出る。
//
// 発行者は設定タブの「請求書の発行者」（既定は MIAMIホールディングス）。
// テナント（この台帳を使う会社）ごとに変えられるよう、台帳に1つだけ持っている。
// 宛先はお客様。滞納が2か月でも3か月でも出せる（月数は台帳から数えて刷る）。
//
// 車体番号は台帳に持たない（どう持つかまだ決まっていない）。
// この画面で手で打つ。空のまま刷れば、手書き用の空欄になる。
// 打った番号は保存しない。
//
// 印刷すると、請求書の紙だけが出る（ほかの画面は刷らない）。
// 端末の印刷で「PDFに保存」を選べば、PDFにもなる。

const 日を足す = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// 期日を過ぎて、まだ払われていない月額の回の数（＝何か月分たまっているか）
export function 滞納月数(支払予定, 今日 = 本日()) {
  return (支払予定 || []).filter((s) => (s.種類 || '通常') === '通常'
    && s.期日 < 今日 && s.状態 !== '入金済み' && (s.請求 - (s.入金 || 0)) > 0).length;
}

export default function Invoice({ c, 支払予定, 入金, 発行者, onClose }) {
  const 今日 = 本日();
  const [請求番号, set請求番号] = useState(`${今日.replace(/-/g, '')}-${c.id}`);
  const [請求日, set請求日] = useState(今日);
  const [期限, set期限] = useState(日を足す(今日, 14));
  const [車体番号, set車体番号] = useState('');
  const [備考, set備考] = useState('');

  const 契約金額 = Number(c.支払総額) || 0;
  const 買取金額 = 七割五分(契約金額);
  const 支払済 = Number(c.入金合計) || 0;
  const 残債 = Math.max(0, 契約金額 - 支払済);
  const 買戻し = 七割五分(残債);
  const 月数 = 滞納月数(支払予定, 今日);
  const 最終入金 = (入金 || []).map((p) => p.日付).filter(Boolean).sort().pop() || '';
  const 郵便 = c.郵便番号 || c.郵便番号推定 || '';
  const 発 = 発行者 || {};
  const 発行者が足りない = !発.住所 || !発.振込先;

  return (
    <div className="inv">
      {/* 打つ欄。紙には刷らない */}
      <div className="inv-edit no-print">
        <div className="inv-edit-h">
          <h3>請求書を作る</h3>
          <div className="inv-edit-b">
            <button className="btn" onClick={onClose}>閉じる</button>
            <button className="btn btn-main" onClick={() => window.print()}>
              印刷する（PDFに保存）
            </button>
          </div>
        </div>
        <div className="inv-grid">
          <label>請求番号<input value={請求番号} onChange={(e) => set請求番号(e.target.value)} /></label>
          <label>請求日<input type="date" value={請求日} onChange={(e) => set請求日(e.target.value)} /></label>
          <label>お支払期限<input type="date" value={期限} onChange={(e) => set期限(e.target.value)} /></label>
          <label>車体番号（手で入れる・保存しません）
            <input value={車体番号} placeholder="空なら手書き用の空欄で刷ります"
                   onChange={(e) => set車体番号(e.target.value)} />
          </label>
          <label className="wide">備考（紙のいちばん下に刷ります）
            <textarea rows={2} value={備考} onChange={(e) => set備考(e.target.value)} />
          </label>
        </div>
        {発行者が足りない && (
          <p className="inv-warn">
            発行者の住所か振込先がまだ入っていません。<b>設定タブの「請求書の発行者」</b>で入れてください。
          </p>
        )}
      </div>

      {/* ここから紙。A4縦 */}
      <div className="inv-page" data-k="請求書">
        <h1>請求書</h1>
        <div className="inv-sub">
          ご契約の残債についてのご請求
          {月数 > 0 && <>（お支払いの遅れ {月数}か月分）</>}
        </div>

        <div className="inv-top">
          <div className="inv-to">
            {(郵便 || c.住所) && (
              <div className="inv-addr">{郵便 && `〒${郵便}`} {c.住所}</div>
            )}
            <b data-k="宛名">{c.氏名} 様</b>
            <div>下記のとおりご請求申し上げます。</div>
          </div>
          <div className="inv-meta">
            <table><tbody>
              <tr><td>請求番号</td><td>{請求番号}</td></tr>
              <tr><td>請求日</td><td>{請求日 ? jpDate(請求日) : ''}</td></tr>
              <tr><td>お支払期限</td><td>{期限 ? jpDate(期限) : ''}</td></tr>
            </tbody></table>
            <div className="inv-from" data-k="発行者">
              <b>{発.名称}</b>
              {(発.郵便番号 || 発.住所) && (
                <div>{発.郵便番号 && `〒${発.郵便番号}`} {発.住所}</div>
              )}
              {発.電話番号 && <div>TEL {発.電話番号}</div>}
              {発.登録番号 && <div>登録番号 {発.登録番号}</div>}
            </div>
          </div>
        </div>

        <div className="inv-big">
          <span>ご請求金額</span>
          <b data-k="ご請求金額">¥{yen(買戻し)}</b>
        </div>

        <h2>ご契約と車両</h2>
        <table className="inv-k"><tbody>
          <tr><th>お客様名</th><td>{c.氏名} 様</td></tr>
          <tr><th>契約日</th><td>{c.契約日 ? jpDate(c.契約日) : ''}</td></tr>
          <tr><th>車種名</th><td>{c.車種 || ''}</td></tr>
          <tr><th>車体番号</th>
            <td className={車体番号 ? '' : 'inv-blank'} data-k="車体番号">{車体番号}</td></tr>
          <tr><th>お支払いの遅れ</th>
            <td>{月数}か月分{最終入金 && `（最終のご入金 ${jpDate(最終入金)}）`}</td></tr>
        </tbody></table>

        <h2>ご請求金額の計算</h2>
        <table className="inv-k"><tbody>
          <tr><th>① 契約金額</th><td className="n">{yen(契約金額)}円</td></tr>
          <tr><th>② 買取金額（① × {割合}%）</th><td className="n">{yen(買取金額)}円</td></tr>
          <tr><th>③ お客様が支払った金額</th><td className="n">{yen(支払済)}円</td></tr>
          <tr><th>④ 残債（① − ③）</th><td className="n">{yen(残債)}円</td></tr>
          <tr className="sum"><th>⑤ 買戻し金額（④ × {割合}%）</th>
            <td className="n">{yen(買戻し)}円</td></tr>
        </tbody></table>
        <div className="inv-f">円未満は切り捨てています。</div>

        <h2>お振込先</h2>
        <table className="inv-k"><tbody>
          <tr><th>振込先</th><td className={発.振込先 ? '' : 'inv-blank'}>{発.振込先}</td></tr>
        </tbody></table>

        {備考 && <div className="inv-note">{備考}</div>}
      </div>
    </div>
  );
}
