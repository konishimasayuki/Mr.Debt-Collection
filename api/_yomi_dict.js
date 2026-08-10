import { norm } from './_lib.js';
// 苗字の読みの下書き。人が確かめて直すための「たたき台」であって、正解ではない。
// 確か:false は読みが分かれる苗字。画面で目印を出し、必ず本人に確認してもらう。
//
// ここに無い苗字は空欄で出す(勝手に当てない)。

const SURNAME = {
  木村: ['キムラ', true],   松本: ['マツモト', true], 村上: ['ムラカミ', true],
  後藤: ['ゴトウ', true],   松永: ['マツナガ', true], 山下: ['ヤマシタ', true],
  清島: ['キヨシマ', false], 松尾: ['マツオ', true],  田代: ['タシロ', true],
  藤田: ['フジタ', true],   志賀: ['シガ', true],     吉田: ['ヨシダ', true],
  添田: ['ソエダ', true],   山本: ['ヤマモト', true], 中川: ['ナカガワ', true],
  高野: ['タカノ', false],  恩地: ['オンチ', false],  田中: ['タナカ', true],
  緒方: ['オガタ', true],   山田: ['ヤマダ', true],   野中: ['ノナカ', true],
  熊上: ['クマガミ', false], 園田: ['ソノダ', true],  桐川: ['キリカワ', false],
  矢野: ['ヤノ', true],     西村: ['ニシムラ', true], 小田: ['オダ', false],
  斎藤: ['サイトウ', true], 長峰: ['ナガミネ', true], 仲山: ['ナカヤマ', true],
  宇佐美: ['ウサミ', true], 齊藤: ['サイトウ', true], 植木: ['ウエキ', true],
  村山: ['ムラヤマ', true], 泉: ['イズミ', true],     三好: ['ミヨシ', true],
  中西: ['ナカニシ', true], 高木: ['タカギ', true],   白川: ['シラカワ', false],
  西脇: ['ニシワキ', true], 岡村: ['オカムラ', true], 納見: ['ノウミ', false],
  山内: ['ヤマウチ', false], 森本: ['モリモト', true], 渡邉: ['ワタナベ', true],
  植田: ['ウエダ', true],   吉武: ['ヨシタケ', true], 五島: ['ゴトウ', false],
  和田: ['ワダ', true],
};

// 苗字を取り出す。「木村 祐介」→「木村」。区切りが無ければ当てない。
function surnameOf(name) {
  const s = String(name || '').trim();
  const m = s.split(/[\s　]+/);
  return m.length > 1 ? m[0] : '';
}

// 下書きを返す。{読み, 確か, 理由}
// 読みが分かれる苗字は**下書きを出さない**。欄が埋まっていると、そのまま送って
// しまいかねないため、間違いうるものは必ず人に打たせる。
function guess(name) {
  const sn = surnameOf(name);
  if (!sn) return { 読み: '', 確か: false, 理由: 'お名前が姓と名に分かれていません' };
  const hit = SURNAME[sn];
  if (!hit) return { 読み: '', 確か: false, 理由: `「${sn}」の読みが辞書にありません` };
  if (!hit[1]) return { 読み: '', 確か: false,
    理由: `「${sn}」は読みが分かれます（${hit[0]} など）。確かめてください` };
  return { 読み: hit[0], 確か: true, 理由: '' };
}

// 索引に使う「行」。あ行・か行…を返す。分からなければ「その他」。
const 行 = [
  ['あ', 'アイウエオヴ'], ['か', 'カキクケコガギグゲゴ'], ['さ', 'サシスセソザジズゼゾ'],
  ['た', 'タチツテトダヂヅデド'], ['な', 'ナニヌネノ'],
  ['は', 'ハヒフヘホバビブベボパピプペポ'], ['ま', 'マミムメモ'], ['や', 'ヤユヨ'],
  ['ら', 'ラリルレロ'], ['わ', 'ワヲン'],
];

// 顧客の並び順・索引に使う読み。登録された「よみ」が無ければ苗字の辞書で補う。
// 補ったものは推定なので、画面では「よみ」として出さない。
function 並び読み(name, kana) {
  const k = String(kana || '').trim();
  if (k) return k;
  const hit = SURNAME[surnameOf(name)];
  return hit ? hit[0] : '';
}

function 索引(name, kana) {
  const k = 並び読み(name, kana)
    .normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s　]/g, '');
  if (!k) return 'その他';
  const 頭 = k[0];
  for (const [名, 文字] of 行) if (文字.includes(頭)) return 名;
  return 'その他';
}

// あいうえお順。登録された「よみ」が無い人は苗字の辞書で補って並べる。
// それでも読みが分からない人だけ、最後にまわす。
//
// 顧客一覧でも、CSVの取り込みで顧客を選ぶ欄でも、同じ並びでなければならない。
// 探す場所によって並びが変わると、目で追えなくなる。
const collator = new Intl.Collator('ja');
const あいうえお順 = (a, b) => {
  const ak = norm(並び読み(a.name, a.kana)), bk = norm(並び読み(b.name, b.kana));
  if (!!ak !== !!bk) return ak ? -1 : 1;
  return collator.compare(ak || a.name, bk || b.name) || a.id - b.id;
};

export { SURNAME, surnameOf, guess, 並び読み, 索引, 行, あいうえお順 };
