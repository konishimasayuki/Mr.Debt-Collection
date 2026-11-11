// 郵便番号。入れてもらった番号を整えるのと、入っていないときに住所から逆に引くの2つ。
//
// 逆引きの表は台帳の中に持っている（api/_zip_table.js）。
// 外のAPIに住所を投げれば表は要らないが、**顧客の住所を外へ出すことになる。**
// 督促の台帳に載っている住所なので、それはしない。
import { gunzipSync } from 'node:zlib';

// 入れてもらった番号を 123-4567 の形にそろえる。
// 全角で打たれても、〒が付いていても、ハイフンが無くても受ける。
// 7桁にならないものは null を返す（呼ぶ側が断る）
export function 郵便番号を整える(s) {
  const 数 = String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/[^0-9]/g, '');
  if (数.length !== 7) return null;
  return 数.slice(0, 3) + '-' + 数.slice(3);
}

// 住所と町域を同じものさしに乗せる。
// 郵便局のデータと、人が手で打った住所は、同じ町でも書き方がそろわない。
//   ・全角の数字と半角の数字（１丁目／1丁目）
//   ・ヶとケ（旭ヶ丘／旭ケ丘）
//   ・大字・小字を書くかどうか
//   ・空白の入れ方
// **表を作るときと引くときで、同じこの関数を通す。**
// 別々に書くと、片方だけ直したときに静かに当たらなくなる
export function そろえる(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/[\s　]/g, '')
    .replace(/[ヶ]/g, 'ケ')
    .replace(/[ヵ]/g, 'カ')
    .replace(/^大字/, '')
    .replace(/大字|小字/g, '');
}

// ── 逆引きの表 ───────────────────────────────
//
// 1.0MB ある。**郵便番号が未入力の顧客を開いたときにだけ**開く。
// 一度開いたら、その関数が生きているあいだは持っておく（同じ人を何度も開くため）
let 表 = null;
let 開いている = null;

async function 表を開く() {
  if (表) return 表;
  if (!開いている) {
    開いている = (async () => {
      const { 郵便番号表 } = await import('./_zip_table.js');
      const 本文 = gunzipSync(Buffer.from(郵便番号表, 'base64')).toString('utf8');
      // 町域の並びは、ここでは**文字列のまま**持っておく。
      // 1892行ぜんぶの町域を切り分けると12万件になり、1回の逆引きには重すぎる。
      // 市区町村が決まってから、その行だけを切り分ける
      表 = 本文.split('\n').filter(Boolean).map((行) => {
        const [県, 市, 既定, 基, 町] = 行.split('\t');
        return { 県, 市, 既定, 基, 町 };
      });
      return 表;
    })();
    開いている.finally(() => { 開いている = null; });
  }
  return 開いている;
}

// その市区町村の中から、残りの住所の頭にいちばん長く当たる町域を探す
function 町域をあてる(行, 残り) {
  let 当 = null;
  for (const 組 of 行.町.split('|')) {
    if (!組) continue;
    const i = 組.lastIndexOf(':');
    if (i < 0) continue;
    const t = 組.slice(0, i);
    if (!t || !残り.startsWith(t)) continue;
    if (当 && 当.町域.length >= t.length) continue;
    const z = 組.slice(i + 1);
    当 = { 町域: t, 番号: z.length === 7 ? z : 行.基 + z };
  }
  return 当;
}

// 住所から郵便番号を引く。引けなければ null。
//
// 返すのは { 番号, どこまで } 。どこまでは '町域' か '市区町村'。
// 町域まで当たれば郵便番号は1つに決まる。市区町村までしか当たらなかったときは
// 「以下に掲載がない場合」の番号なので、**画面でそう断っておく**
export async function 住所から郵便番号(住所) {
  const 元 = String(住所 == null ? '' : 住所);
  if (!元.trim()) return null;

  // 住所の中に郵便番号が書き込まれていることがある（「〒100-0001 東京都…」）。
  // それがあるなら、それがいちばん確かな答え
  const 書いてある = 元.normalize('NFKC').match(/〒?\s*(\d{3})[-ー－\s]?(\d{4})/);
  if (書いてある) {
    return { 番号: `${書いてある[1]}-${書いてある[2]}`, どこまで: '住所に書いてある' };
  }

  const A = そろえる(元);
  if (!A) return null;
  const 表 = await 表を開く();

  // 都道府県から書いてある住所と、市区町村から始まる住所の両方を受ける。
  // 都道府県が書いてあるほうが確かなので、あればそちらだけで決める
  const 県あり = [], 県なし = [];
  for (const 行 of 表) {
    if (A.startsWith(行.県 + 行.市)) 県あり.push([行, A.slice(行.県.length + 行.市.length)]);
    else if (A.startsWith(行.市)) 県なし.push([行, A.slice(行.市.length)]);
  }
  const 候補 = 県あり.length ? 県あり : 県なし;
  if (!候補.length) return null;

  // 市区町村と町域を合わせていちばん長く当たったものを採る。
  // 都道府県が書かれていない住所でも、町域まで当たれば1つに決まることが多い
  //（「府中市」は東京都と広島県にあるが、その先の町域は重なっていない）
  let 最良 = null;
  for (const [行, 残り] of 候補) {
    const t = 町域をあてる(行, 残り);
    const 長さ = 行.市.length + (t ? t.町域.length : 0);
    const 札 = { 行, 番号: t ? t.番号 : 行.既定, どこまで: t ? '町域' : '市区町村', 長さ };
    if (!札.番号) continue;
    if (!最良 || 長さ > 最良.長さ
        || (長さ === 最良.長さ && 最良.どこまで === '市区町村' && 札.どこまで === '町域')) {
      最良 = 札;
    }
  }
  if (!最良) return null;

  // 同じ長さで答えが分かれるなら、決められない。黙って片方を出すほうが害になる
  //（督促の封書に別の町の番号を刷ってしまう）
  const 並 = 候補
    .map(([行, 残り]) => {
      const t = 町域をあてる(行, 残り);
      return { 番号: t ? t.番号 : 行.既定, 長さ: 行.市.length + (t ? t.町域.length : 0) };
    })
    .filter((x) => x.番号 && x.長さ === 最良.長さ);
  if (new Set(並.map((x) => x.番号)).size > 1) return null;

  const z = 最良.番号;
  if (!/^\d{7}$/.test(z)) return null;
  return { 番号: z.slice(0, 3) + '-' + z.slice(3), どこまで: 最良.どこまで };
}
