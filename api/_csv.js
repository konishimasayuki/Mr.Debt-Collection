// 入金CSVの読み取り。
// 銀行によって形が違うので、2つの形に対応する。
//   1) 全銀協規定形式(入出金明細・種別03) … 行頭が 1/2/8/9 のレコード区分
//   2) ふつうのCSV … 見出し行から「日付」「付番」「金額」「名前」の列を見つける
// どちらでも {日付, 付番, 金額, 振込人} の並びにそろえて返す。

const pad = (n) => String(n).padStart(2, '0');

// 1行をフィールドへ。引用符の中のカンマは区切らない
function fields(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

const digits = (s) => String(s == null ? '' : s).replace(/[^0-9-]/g, '');

// 和暦YYMMDD → 西暦。令和固定(令和N年 = 2018+N)
function wareki(yymmdd) {
  const s = String(yymmdd).padStart(6, '0');
  const yy = +s.slice(0, 2), mm = +s.slice(2, 4), dd = +s.slice(4, 6);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${2018 + yy}-${pad(mm)}-${pad(dd)}`;
}

// いろいろな書き方の日付を YYYY-MM-DD にそろえる
function anyDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})(\d{2})(\d{2})$/);          // 和暦YYMMDD
  if (m) return wareki(s);
  return null;
}

// 全銀協規定形式か。行頭の区分が 1/2/8/9 で、データ行(2)がある
function looksZengin(lines) {
  const kinds = lines.map((l) => (l.includes(',') ? fields(l)[0] : l.slice(0, 1)));
  return kinds.includes('2') && (kinds.includes('1') || kinds.includes('8'));
}

function parseZengin(lines) {
  const isCsv = lines.some((l) => l.includes(','));
  const out = [];
  const 読み飛ばし = [];
  let trailer = null;
  lines.forEach((line, i) => {
    const 飛ばす = (理由) => 読み飛ばし.push(
      { 行: i + 1, 理由, 中身: String(line).slice(0, 60) });
    const f = isCsv ? fields(line) : line;
    const kubun = isCsv ? f[0] : line.slice(0, 1);
    if (kubun === '2') {
      let 勘定日, 入払, 取引, 金額, 名前, 付番;
      if (isCsv) {
        勘定日 = f[2]; 入払 = f[4]; 取引 = f[5];
        金額 = digits(f[6]); 付番 = f[7] || ''; 名前 = f[14] || '';
      } else {
        勘定日 = line.slice(9, 15); 入払 = line.slice(21, 22); 取引 = line.slice(22, 24);
        金額 = digits(line.slice(24, 36)); 付番 = line.slice(42, 62).trim();
        名前 = line.slice(81, 129).trim();
      }
      if (入払 !== '1') return 飛ばす('出金の行です（入金だけ取り込みます）');
      if (取引 === '19') return 飛ばす('訂正の行です');
      const iso = wareki(勘定日);
      if (!iso) return 飛ばす('日付が読み取れません');
      if (!+金額) return 飛ばす('金額が読み取れません');
      out.push({ 日付: iso, 付番: String(付番).trim(), 金額: +金額, 振込人: String(名前).trim() });
    } else if (kubun === '8') {
      trailer = isCsv
        ? { 件数: +digits(f[1]), 合計: +digits(f[2]) }
        : { 件数: +digits(line.slice(1, 7)), 合計: +digits(line.slice(7, 20)) };
    }
  });
  return { 明細: out, トレーラ: trailer, 形式: '全銀協規定形式', 読み飛ばし };
}

// 見出しから列を探す。見つからなければ位置で拾う。
//
// 銀行によっては「出金金額」と「入金金額」が別の列に分かれている。
// どちらも「金額」を含むので、ただ「金額」を探すと出金のほうを拾ってしまう。
// 台帳に入れるのは入金だけなので、入金の列を先に、名指しで探す。
const HEAD = {
  日付: ['日付', '取引日', '勘定日', '入金日', '年月日', 'date'],
  付番: ['付番', '番号', '照会番号', '整理番号', 'no', 'ｎｏ'],
  入金: ['入金金額', '入金額', 'お預り金額', '預り金額', '預入金額', '入金', 'お預り', '預入'],
  出金: ['出金金額', 'お支払金額', '支払金額', '出金額', '引出金額', '払戻金額',
        '出金', 'お支払', '支払', '引出', '払戻'],
  金額: ['金額', 'amount'],
  区分: ['取引区分', '入出金区分', '取引種別', '種別'],
  振込人: ['振込人', '依頼人', '名義', '摘要', 'お名前', '振込依頼人名', 'name'],
};
function findCols(head) {
  const h = head.map((x) => String(x).normalize('NFKC').toLowerCase().replace(/\s/g, ''));
  const 探す = (words, 除く) => h.findIndex((c, i) =>
    c && i !== 除く && words.some((w) => c.includes(w)));
  const col = {};
  for (const key of ['日付', '付番', '区分', '振込人']) col[key] = 探す(HEAD[key]);
  col.入金 = 探す(HEAD.入金);
  col.出金 = 探す(HEAD.出金, col.入金);
  // 入金の列が分かるならそれを使う。分からなければ、出金ではない「金額」の列
  col.金額 = col.入金 >= 0 ? col.入金 : 探す(HEAD.金額, col.出金);
  return col;
}

function parsePlain(lines) {
  const rows = lines.map(fields);
  const col = findCols(rows[0] || []);
  const hasHead = col.日付 >= 0 || col.金額 >= 0;
  const body = hasHead ? rows.slice(1) : rows;
  const c = hasHead ? col : { 日付: 0, 付番: 1, 金額: 2, 振込人: 3 };

  // 取引区分の列があるときは、振込の入金だけを取り込む。
  // 利息やATMでの現金入金は、お客様からの振り込みではない。
  // ただし「振込」と書かれた行が1つも無いファイルでは、この絞り込みはしない。
  // 銀行によって区分の言い方が違うので、全部落ちてしまうのを防ぐ。
  const 振込で絞る = c.区分 >= 0
    && body.some((f) => String(f[c.区分] || '').includes('振込'));

  const out = [];
  // 読めない行は落とすが、黙って落とさない。
  // 列がずれていると全部落ちる。件数しか見ていないと気づけず、
  // 入っていない入金を未入金として督促してしまう。
  const 読み飛ばし = [];
  body.forEach((f, i) => {
    const 行番号 = i + (hasHead ? 2 : 1);
    if (!f.length || f.every((x) => !x)) return;      // 空行は数えない
    const 飛ばす = (理由) => 読み飛ばし.push(
      { 行: 行番号, 理由, 中身: f.join(',').slice(0, 60) });

    // 入金の列がはっきりしているなら、そこが空の行は入金ではない
    if (c.入金 >= 0 && !+digits(f[c.入金])) {
      const 出 = c.出金 >= 0 ? +digits(f[c.出金]) : 0;
      return 飛ばす(出 ? '出金の行です（入金だけ取り込みます）' : '入金額が空の行です');
    }
    if (振込で絞る) {
      const k = String(f[c.区分] || '').trim();
      if (!k.includes('振込')) {
        return 飛ばす(`振込ではない入金です（${k || '区分なし'}）`);
      }
    }

    const iso = anyDate(c.日付 >= 0 ? f[c.日付] : '');
    const amount = +digits(c.金額 >= 0 ? f[c.金額] : '');
    if (!iso) return 飛ばす('日付が読み取れません');
    if (!amount || amount <= 0) return 飛ばす('金額が読み取れません');
    out.push({
      日付: iso,
      付番: c.付番 >= 0 ? String(f[c.付番] || '').trim() : '',
      金額: amount,
      振込人: c.振込人 >= 0 ? String(f[c.振込人] || '').trim() : '',
    });
  });
  return { 明細: out, トレーラ: null, 読み飛ばし,
    形式: hasHead ? '見出しつきCSV' : 'CSV（見出しなし）' };
}

function parseCsv(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
    .filter((l) => l.trim().length);
  if (!lines.length) throw new Error('中身が空です。');
  const r = looksZengin(lines) ? parseZengin(lines) : parsePlain(lines);
  if (!r.明細.length) {
    // なぜ読めなかったかを言う。「0件でした」だけでは、
    // 列の並びが違うのか、そもそも入金が無いのかが分からない。
    const 理由 = (r.読み飛ばし || []).slice(0, 3)
      .map((x) => `${x.行}行目：${x.理由}`).join(' / ');
    throw new Error('入金の行が1件も読み取れませんでした。'
      + (理由 ? `（${理由}）` : ''));
  }
  return r;
}

export { parseCsv, fields, anyDate, wareki };
