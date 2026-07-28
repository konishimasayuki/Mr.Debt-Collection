// 全銀協規定形式(入出金明細・種別03)の解析。画面と同じ判定をサーバー側で行う。
// CSV(カンマ・可変長)と固定長200バイトの両方に対応。
// 文字コードはShift-JIS、日付は和暦YYMMDD、振込依頼人名は半角カナ。

const pad = (n) => String(n).padStart(2, '0');

// 名寄せの正規化:半角/全角カナを統一(NFKC)、法人格・記号・空白を除く
function normKana(s) {
  return (s || '').normalize('NFKC')
    .replace(/[\s　]/g, '')
    .replace(/株式会社|有限会社|（株）|\(株\)|（有）|\(有\)|カブシキガイシャ/g, '')
    .replace(/^カ\)|（カ$|\(カ$|カ\)$/g, '')
    .replace(/[()（）.,･・ｰー-]/g, '')
    .toUpperCase();
}

// 和暦YYMMDD → 西暦。令和固定(令和N年 = 2018+N)
function warekiToDate(yymmdd) {
  const s = String(yymmdd).padStart(6, '0');
  const yy = +s.slice(0, 2), mm = +s.slice(2, 4), dd = +s.slice(4, 6);
  return { y: 2018 + yy, m: mm, d: dd, iso: `${2018 + yy}-${pad(mm)}-${pad(dd)}` };
}

const csvFields = (line) =>
  line.split(',').map((f) => f.trim().replace(/^"(.*)"$/, '$1').trim());

function parseZengin(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim().length);
  if (!lines.length) throw new Error('中身が空です。');
  const isCsv = lines.some((l) => l.includes(','));
  const deposits = [];
  let trailer = null, dataSeen = 0;

  for (const line of lines) {
    let kubun, f;
    if (isCsv) { f = csvFields(line); kubun = f[0]; }
    else { f = line; kubun = line.slice(0, 1); }

    if (kubun === '2') {
      dataSeen++;
      let nyubarai, amount, kanjoubi, payer, torihiki;
      if (isCsv) {
        kanjoubi = f[2]; nyubarai = f[4]; torihiki = f[5];
        amount = +String(f[6]).replace(/[^0-9]/g, ''); payer = f[14] || '';
      } else {
        kanjoubi = f.slice(9, 15); nyubarai = f.slice(21, 22); torihiki = f.slice(22, 24);
        amount = +f.slice(24, 36).replace(/[^0-9]/g, ''); payer = (f.slice(81, 129) || '').trim();
      }
      if (nyubarai !== '1') continue;   // 入金だけ。出金は無視
      if (torihiki === '19') continue;  // 訂正は取込対象外
      const d = warekiToDate(kanjoubi);
      deposits.push({ iso: d.iso, amount, payer: payer.trim() });
    } else if (kubun === '8') {
      trailer = isCsv
        ? { inCount: +f[1], inTotal: +String(f[2]).replace(/[^0-9]/g, '') }
        : { inCount: +f.slice(1, 7), inTotal: +f.slice(7, 20).replace(/[^0-9]/g, '') };
    }
  }
  if (!dataSeen) throw new Error('全銀協規定形式のデータレコード(区分2)が見つかりません。');

  // 二重取込を弾く鍵。照会番号は重複しうるので、日付+金額+依頼人名+同一内の連番で作る
  const seen = {};
  deposits.forEach((d) => {
    const base = `${d.iso}|${d.amount}|${normKana(d.payer)}`;
    seen[base] = (seen[base] || 0) + 1;
    d.import_key = `${base}|${seen[base]}`;
  });

  return { deposits, trailer };
}

module.exports = { parseZengin, normKana };
