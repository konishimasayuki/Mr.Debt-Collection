import { useState } from 'react';
import { yen, jpDate, 本日 } from '../api';
import { 割合, 七割五分 } from './kaimodoshi';

// 請求書。計算タブで顧客を選び「請求書を作る」を押すと出る。**請求書はここからだけ出す。**
//
// 発行者（右上）は設定タブの「自社（請求書の発行者）」（既定は MIAMIホールディングス）。
// テナント（この台帳を使う会社）ごとに変えられるよう、台帳に1つだけ持っている。
// 請求先（左上）は、設定タブの「債権会社」から選ぶ。はじめはその顧客の債権譲渡会社。
// 表に刷るお客様名は、この画面で直せる（保存はしない）。
// 滞納が何か月でも出せる。遅れの月数は刷らない。
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

export default function Invoice({ c, 会社, 発行者, onClose }) {
  const 今日 = 本日();
  const 会社一覧 = 会社 || [];
  // 請求先。はじめはその顧客の債権譲渡会社（登録が無ければ「選ばない」）
  const 既定の先 = 会社一覧.some((x) => x.id === c.債権譲渡会社id) ? String(c.債権譲渡会社id) : '';
  const [請求先id, set請求先id] = useState(既定の先);
  const [お客様名, setお客様名] = useState(c.氏名 || '');
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
  const 先 = 会社一覧.find((x) => String(x.id) === 請求先id) || null;
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
          <label className="half">請求先（左上に刷る会社）
            <select value={請求先id} onChange={(e) => set請求先id(e.target.value)} data-k="請求先を選ぶ">
              <option value="">選ばない（宛先を空けて刷る）</option>
              {会社一覧.map((x) => <option key={x.id} value={x.id}>{x.名前}</option>)}
            </select>
          </label>
          <label className="half">お客様名（表に刷る名前・保存しません）
            <input value={お客様名} onChange={(e) => setお客様名(e.target.value)} data-k="お客様名を直す" />
          </label>
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
            自社の住所か振込先がまだ入っていません。<b>設定タブの「自社（請求書の発行者）」</b>で入れてください。
          </p>
        )}
      </div>

      {/* ここから紙。A4縦 */}
      <div className="inv-page" data-k="請求書">
        <h1>請求書</h1>
        <div className="inv-sub">ご契約の残債についてのご請求</div>

        <div className="inv-top">
          {/* 請求先（設定タブの債権会社から選んだ会社）。選ばなければ手書き用に空けておく */}
          <div className="inv-to" data-k="請求先">
            {先 && (先.郵便番号 || 先.住所) && (
              <div className="inv-addr">{先.郵便番号 && `〒${先.郵便番号}`} {先.住所}</div>
            )}
            <b data-k="宛名">{先 ? `${先.名前} 御中` : '　　　　　　　　　　御中'}</b>
            {先 && 先.担当者 && <div className="inv-addr">{先.担当者}</div>}
            {先 && 先.電話番号 && <div className="inv-addr">TEL {先.電話番号}</div>}
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
          <tr><th>お客様名</th><td data-k="お客様名">{お客様名 ? `${お客様名} 様` : ''}</td></tr>
          <tr><th>契約日</th><td>{c.契約日 ? jpDate(c.契約日) : ''}</td></tr>
          <tr><th>車種名</th><td>{c.車種 || ''}</td></tr>
          <tr><th>車体番号</th>
            <td className={車体番号 ? '' : 'inv-blank'} data-k="車体番号">{車体番号}</td></tr>
        </tbody></table>

        <h2>ご請求金額の計算</h2>
        <table className="inv-k"><tbody>
          <tr><th>① 契約金額</th><td className="n">{yen(契約金額)}円</td></tr>
          <tr><th>② 買取金額（① × 手数料{割合}%）</th><td className="n">{yen(買取金額)}円</td></tr>
          <tr><th>③ お客様が支払った金額</th><td className="n">{yen(支払済)}円</td></tr>
          <tr><th>④ 残債（① − ③）</th><td className="n">{yen(残債)}円</td></tr>
          <tr className="sum"><th>⑤ 買戻し金額（④ × 手数料{割合}%）</th>
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
