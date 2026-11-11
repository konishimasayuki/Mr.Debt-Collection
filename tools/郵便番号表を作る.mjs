// 郵便局の公式データから、住所→郵便番号の逆引き表（api/_zip_table.js）を作る。
//
// なぜ台帳の中に持つのか
//   住所から郵便番号を引くには、郵便局のデータが要る。
//   外の無料APIに住所を投げれば表は持たなくて済むが、**顧客の住所を外へ出すことになる。**
//   督促の台帳に載っている住所なので、それはしない。表を抱えて中だけで引く。
//
// 使い方
//   1. 郵便局の配布ページから「住所の郵便番号（1レコード1行、UTF-8形式）」を落とす
//      https://www.post.japanpost.jp/zipcode/dl/utf-zip.html
//      （2026年に配布のURLが変わっている。上のページから辿るのが確実）
//   2. unzip して utf_ken_all.csv を取り出す
//   3. node tools/郵便番号表を作る.mjs <utf_ken_all.csv のあるところ>
//
// 郵便番号は年に何度も変わる（町ができる・分かれる）。
// 直したいときは、新しいCSVでこれを流し直すだけでよい。CSVそのものは台帳に入れない（18MBある）。
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { そろえる } from '../api/_zip.js';

const CSV = process.argv[2];
if (!CSV) {
  console.error('使い方: node tools/郵便番号表を作る.mjs <utf_ken_all.csv>');
  process.exit(1);
}
const 出す先 = path.join(new URL('..', import.meta.url).pathname, 'api/_zip_table.js');

// CSVを1行ずつ。引用符の中に読点が入ることがあるので、素朴な split は使わない
function 分ける(行) {
  const 欄 = [];
  let 今 = '', 中 = false;
  for (const c of 行) {
    if (c === '"') { 中 = !中; continue; }
    if (c === ',' && !中) { 欄.push(今); 今 = ''; continue; }
    今 += c;
  }
  欄.push(今);
  return 欄;
}

const 本文 = fs.readFileSync(CSV, 'utf8');
const 既定 = new Map();                        // '県\t市' → 7桁
const 町 = new Map();                          // '県\t市' → Map(町域 → Map(7桁 → 強さ))
let 読んだ = 0;

// かっこの中の注記で、その行がどれだけ「その町域の代表」かを決める。
//   2 … かっこが無い。町域そのもの（いちばん強い）
//   1 … （その他）。その町域の、ほかに挙がっていないぶんぜんぶ。これも代表
//   0 … （１〜１９丁目）（１５階）など。丁目や階まで見ないと決まらない
const 強さ = (域) => {
  const i = 域.indexOf('（');
  if (i < 0) return 2;
  return 域.slice(i) === '（その他）' ? 1 : 0;
};

for (const 行 of 本文.split(/\r?\n/)) {
  if (!行.trim()) continue;
  const f = 分ける(行);
  const [, , zip, , , , 県, 市, 域] = f;
  if (!/^\d{7}$/.test(zip || '')) continue;
  読んだ++;
  const 鍵 = 県 + '\t' + そろえる(市);
  // 「以下に掲載がない場合」「○○市の次に番地がくる場合」は、その市区町村の既定の番号
  if (域 === '以下に掲載がない場合' || 域.endsWith('の次に番地がくる場合')) {
    既定.set(鍵, zip);
    continue;
  }
  // かっこの中は「１〜１９丁目」「その他」「１５階」など、丁目や階で番号が分かれる注記。
  // かっこを落として町域の名前だけにし、同じ名前に番号が2つ以上あるときは
  // **強い行（町域そのもの → その他）を採る。**
  // 例：名古屋市中村区「名駅（その他）」は450-0002で、これが名駅の代表。
  //     「名駅（１−１−８、…）」の453-0002はその中の特定の番地ぶん。
  // どれも弱い行しか無い町域（札幌の「大通西（１〜１９丁目）」など）は**載せない**。
  // 丁目まで見ないと決められず、黙って片方を出すと別の町の番号になる
  const t = そろえる(域.replace(/（.*$/, ''));
  if (!t) continue;
  if (!町.has(鍵)) 町.set(鍵, new Map());
  const m = 町.get(鍵);
  if (!m.has(t)) m.set(t, new Map());
  const z = m.get(t);
  z.set(zip, Math.max(z.get(zip) || 0, 強さ(域)));
}

// 1行＝1市区町村。県 \t 市区町村 \t 既定の7桁 \t 市区町村でいちばん多い上3桁 \t 町域:番号|…
//
// 町域の番号は、上3桁がその市区町村のふだんの3桁と同じなら**下4桁だけ**にする。
// 同じ3桁が何万回も並ぶのを削る（2.3MB → 2.0MB）。
const 行たち = [];
let 載せた = 0, 外した = 0;
for (const 鍵 of [...町.keys()].sort()) {
  const m = 町.get(鍵);
  const 決 = [];
  for (const [t, zs] of m) {
    if (zs.size === 1) { 決.push([t, [...zs.keys()][0]]); continue; }
    // いちばん強い行だけを見て、それが1つに絞れたら採る
    const 最強 = Math.max(...zs.values());
    const 勝ち = [...zs].filter(([, s]) => s === 最強).map(([z]) => z);
    if (最強 > 0 && 勝ち.length === 1) 決.push([t, 勝ち[0]]);
    else 外した++;
  }
  // いちばん多い上3桁
  const 数 = new Map();
  決.forEach(([, z]) => 数.set(z.slice(0, 3), (数.get(z.slice(0, 3)) || 0) + 1));
  let 基 = '';
  let 最多 = 0;
  for (const [k, v] of 数) if (v > 最多) { 最多 = v; 基 = k; }
  // 番号の順に並べると、同じ番号どおしが隣り合って gzip がよく効く
  決.sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : (a[1] < b[1] ? -1 : 1)));
  載せた += 決.length;
  const [県, 市] = 鍵.split('\t');
  行たち.push([県, 市, 既定.get(鍵) || '', 基,
    決.map(([t, z]) => t + ':' + (z.slice(0, 3) === 基 ? z.slice(3) : z)).join('|')].join('\t'));
}

const 生 = Buffer.from(行たち.join('\n') + '\n', 'utf8');
const 縮 = gzipSync(生, { level: 9 });
const b64 = 縮.toString('base64');

fs.writeFileSync(出す先, `// 住所→郵便番号の逆引き表。**手で直さないこと。**
// tools/郵便番号表を作る.mjs が郵便局の公式データから作っている。
// 直すときは新しいCSVでそれを流し直す（作り方はその道具の冒頭に書いてある）。
//
// 元: 郵便局「住所の郵便番号（1レコード1行、UTF-8形式）」utf_ken_all.csv
// 作った日: ${new Date().toISOString().slice(0, 10)}
// 市区町村 ${行たち.length} / 町域 ${載せた}（丁目や階で分かれて決まらない ${外した} は載せていない）
//
// gzip して base80…ではなく base64。1.0MB。読むのは api/_zip.js で、
// **郵便番号が未入力の顧客を開いたときにだけ**開く（ふだんは触らない）。
export const 郵便番号表 = '${b64}';
`);

console.log(`CSV ${読んだ}行 → 市区町村 ${行たち.length} / 町域 ${載せた} / 外した ${外した}`);
console.log(`生 ${(生.length / 1e6).toFixed(2)}MB → gzip ${(縮.length / 1e6).toFixed(2)}MB`
  + ` → 書き出し ${(b64.length / 1e6).toFixed(2)}MB`);
console.log('書いた:', 出す先);
