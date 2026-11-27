// 支払い金額の決まり。回ごとの金額をどう決めるか。
//
//   基本     … 毎月の金額（必ずある）
//   偶数月   … 期日が偶数の月（2・4・6・8・10・12月）の回はこの額
//   奇数月   … 期日が奇数の月（1・3・5・7・9・11月）の回はこの額
//   初回     … 1回目だけこの額
//   最終回   … 最後の回だけこの額
//
// どれも空でよい（空なら基本）。重なったときの強さは
//   最終回 ＞ 初回 ＞ 偶数月・奇数月 ＞ 基本
// 「偶数月はA・奇数月はB・最終回はC」のように組み合わせて使う。
//
// **台帳の裏側（API）と画面の両方から、このファイルをそのまま読む。**
// 片方だけ直して、登録の画面に出る見込みと実際の予定が食い違わないようにするため。
// だからここには Node の部品を使わない。

export const 決まりの欄 = ['基本', '偶数月', '奇数月', '初回', '最終回'];

// k 回目（1から）・全 term 回・期日 'YYYY-MM-DD' の回の金額
export function 回の金額(決まり, k, term, 期日) {
  const d = 決まり || {};
  if (k === term && d.最終回) return d.最終回;
  if (k === 1 && d.初回) return d.初回;
  const 月 = Number(String(期日 || '').slice(5, 7));
  if (月 && 月 % 2 === 0 && d.偶数月) return d.偶数月;
  if (月 && 月 % 2 === 1 && d.奇数月) return d.奇数月;
  return d.基本;
}

// 基本のほかに何か決めてあるか（ふつうの毎月同じ額ではないか）
export const 変わり種か = (決まり) => !!(決まり
  && (決まり.偶数月 || 決まり.奇数月 || 決まり.初回 || 決まり.最終回));

// 月の偶数・奇数で額が変わるか。期日が動いたら金額も合わせ直す必要がある
export const 月で変わるか = (決まり) => !!(決まり && (決まり.偶数月 || 決まり.奇数月));

// 入ってきた値（画面・API）を決まりに直す。
// 返すのは { 決まり } か { エラー }。空欄は null（＝基本と同じ）にする
export function 決まりを読む(入, 基本の名 = '基本') {
  const 決まり = {};
  for (const k of 決まりの欄) {
    const 生 = 入 ? 入[k === '基本' ? 基本の名 : k] : undefined;
    if (生 === undefined || 生 === null || String(生).trim() === '') {
      決まり[k] = null;
      continue;
    }
    const n = Math.round(Number(String(生).replace(/[,，円\s]/g, '')));
    if (!Number.isFinite(n) || n <= 0) {
      return { エラー: `${k === '基本' ? '毎月の金額' : `${k}の金額`}を正しく入れてください。` };
    }
    if (n > 100000000) return { エラー: '金額が大きすぎます。' };
    決まり[k] = n;
  }
  if (!決まり.基本) return { エラー: '毎月の金額を入れてください。' };
  return { 決まり };
}

// 決まりを、人が読める短い文にする（記録やメモに残す）
export function 決まりの文(決まり) {
  const d = 決まり || {};
  const 円 = (n) => `${Number(n).toLocaleString('ja-JP')}円`;
  const 文 = [`毎月 ${円(d.基本)}`];
  if (d.偶数月) 文.push(`偶数月 ${円(d.偶数月)}`);
  if (d.奇数月) 文.push(`奇数月 ${円(d.奇数月)}`);
  if (d.初回) 文.push(`初回 ${円(d.初回)}`);
  if (d.最終回) 文.push(`最終回 ${円(d.最終回)}`);
  return 文.join('・');
}

// 期日の並び（登録の画面で見込みを出すため）。API の dueOf と同じ数え方
export function 期日の並び(y0, m0, 日, term) {
  const 出 = [];
  for (let k = 1; k <= term; k++) {
    const t = y0 * 12 + (m0 - 1) + (k - 1);
    const y = Math.floor(t / 12), m = (t % 12) + 1;
    const 末 = new Date(y, m, 0).getDate();
    出.push(`${y}-${String(m).padStart(2, '0')}-${String(Math.min(日, 末)).padStart(2, '0')}`);
  }
  return 出;
}
