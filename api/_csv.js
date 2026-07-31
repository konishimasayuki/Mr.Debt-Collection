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
  let trailer = null;
  for (const line of lines) {
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
      if (入払 !== '1') continue;        // 入金だけ。出金は取り込まない
      if (取引 === '19') continue;       // 訂正は取り込まない
      const iso = wareki(勘定日);
      if (!iso || !+金額) continue;
      out.push({ 日付: iso, 付番: String(付番).trim(), 金額: +金額, 振込人: String(名前).trim() });
    } else if (kubun === '8') {
      trailer = isCsv
        ? { 件数: +digits(f[1]), 合計: +digits(f[2]) }
        : { 件数: +digits(line.slice(1, 7)), 合計: +digits(line.slice(7, 20)) };
    }
  }
  return { 明細: out, トレーラ: trailer, 形式: '全銀協規定形式' };
}

// 見出しから列を探す。見つからなければ位置で拾う
const HEAD = {
  日付: ['日付', '取引日', '勘定日', '入金日', '年月日', 'date'],
  付番: ['付番', '番号', '照会番号', '整理番号', 'no', 'ｎｏ'],
  金額: ['金額', '入金', '入金額', 'お預り金額', '預入', 'amount'],
  振込人: ['振込人', '依頼人', '名義', '摘要', 'お名前', '振込依頼人名', 'name'],
};
function findCols(head) {
  const h = head.map((x) => String(x).normalize('NFKC').toLowerCase().replace(/\s/g, ''));
  const col = {};
  for (const [key, words] of Object.entries(HEAD)) {
    col[key] = h.findIndex((c) => c && words.some((w) => c.includes(w)));
  }
  return col;
}

function parsePlain(lines) {
  const rows = lines.map(fields);
  const col = findCols(rows[0] || []);
  const hasHead = col.日付 >= 0 || col.金額 >= 0;
  const body = hasHead ? rows.slice(1) : rows;
  const c = hasHead ? col : { 日付: 0, 付番: 1, 金額: 2, 振込人: 3 };

  const out = [];
  for (const f of body) {
    if (!f.length || f.every((x) => !x)) continue;
    const iso = anyDate(c.日付 >= 0 ? f[c.日付] : '');
    const amount = +digits(c.金額 >= 0 ? f[c.金額] : '');
    if (!iso || !amount || amount <= 0) continue;      // 読めない行は落とす
    out.push({
      日付: iso,
      付番: c.付番 >= 0 ? String(f[c.付番] || '').trim() : '',
      金額: amount,
      振込人: c.振込人 >= 0 ? String(f[c.振込人] || '').trim() : '',
    });
  }
  return { 明細: out, トレーラ: null, 形式: hasHead ? '見出しつきCSV' : 'CSV（見出しなし）' };
}

function parseCsv(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
    .filter((l) => l.trim().length);
  if (!lines.length) throw new Error('中身が空です。');
  const r = looksZengin(lines) ? parseZengin(lines) : parsePlain(lines);
  if (!r.明細.length) throw new Error('入金の行が1件も読み取れませんでした。');
  return r;
}

export { parseCsv, fields, anyDate, wareki };
