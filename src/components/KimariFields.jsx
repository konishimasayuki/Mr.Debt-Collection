import { Money } from './ui';
import { yen } from '../api';
import { 回の金額, 期日の並び, 変わり種か } from '../../api/_kimari.js';

// 支払い金額の決まりの欄（新規登録と顧客編集で使う）。
//
//   偶数月の金額 ／ 奇数月の金額 ／ 初回の金額 ／ 最終回の金額
//
// どれも空でよい（空なら毎月の金額）。下に、実際にどの回がいくらになるかの見込みを出す。
// 決まりの中身は api/_kimari.js（台帳の裏側と同じものを読む）。
//
// v       … { 偶数月, 奇数月, 初回, 最終回 }（'' か数）
// 基本    … 毎月の金額
// 回数 / 開始月('YYYY-MM') / 支払日 … 見込みを出すため
// 払った  … 回次 → いまの額（顧客編集で、入金のある回は変わらないので、いまの額のまま見せる）
export function 決まりにする(基本, v) {
  const n = (x) => (x === '' || x == null ? null : Number(x) || null);
  return { 基本: Number(基本) || 0, 偶数月: n(v.偶数月), 奇数月: n(v.奇数月),
    初回: n(v.初回), 最終回: n(v.最終回) };
}

export default function KimariFields({ v, set, 基本, 回数, 開始月, 支払日, 払った, 期日ら }) {
  const 決まり = 決まりにする(基本, v);
  const 回 = Number(回数) || 0;
  const [y0, m0] = String(開始月 || '').split('-').map(Number);
  // 期日（顧客編集ではいまの予定の期日、登録では開始月から数える）
  const 期日 = 期日ら && 期日ら.length === 回 ? 期日ら
    : (y0 && m0 && 回 > 0 ? 期日の並び(y0, m0, Number(支払日) || 1, 回) : []);
  const 並び = 期日.map((d, i) => ({
    no: i + 1, 期日: d,
    払った: !!(払った && 払った[i + 1] != null),
    額: 払った && 払った[i + 1] != null ? 払った[i + 1] : 回の金額(決まり, i + 1, 回, d),
  }));
  const 合計 = 並び.reduce((a, x) => a + (x.額 || 0), 0);
  // 見込みは最初の4回と最後の2回だけ出す（48回ぜんぶは長すぎる）
  const 見せる = 並び.length <= 7 ? 並び : [...並び.slice(0, 4), null, ...並び.slice(-2)];

  return (
    <div className="kimari">
      <div className="kimari-h">
        <b>金額の決まり（任意）</b>
        <span>空なら毎月の金額。重なったときは 最終回 ＞ 初回 ＞ 偶数月・奇数月 の順に強い</span>
      </div>
      <div className="grid4">
        <Money label="偶数月の金額" value={v.偶数月} onChange={set('偶数月')}
               placeholder={基本 ? yen(基本) : ''} hint="2・4・6・8・10・12月" />
        <Money label="奇数月の金額" value={v.奇数月} onChange={set('奇数月')}
               placeholder={基本 ? yen(基本) : ''} hint="1・3・5・7・9・11月" />
        <Money label="初回の金額" value={v.初回} onChange={set('初回')}
               placeholder={基本 ? yen(基本) : ''} />
        <Money label="最終回の金額" value={v.最終回} onChange={set('最終回')}
               placeholder={基本 ? yen(基本) : ''} />
      </div>
      {基本 > 0 && 並び.length > 0 && (
        <div className="kimari-p" data-k="金額の見込み">
          {見せる.map((x, i) => (x ? (
            <span key={x.no} className={x.払った ? 'paid' : ''}
                  title={x.払った ? '入金のある回は変わりません' : ''}>
              {x.no}回 <i>{Number(x.期日.slice(5, 7))}月</i> <b>{yen(x.額)}</b>
            </span>
          ) : <span key={'…' + i} className="gap">…</span>))}
          {変わり種か(決まり) && (
            <em>月額の回の合計 <b data-k="予定の合計">{yen(合計)}円</b></em>
          )}
        </div>
      )}
    </div>
  );
}
