// よみ(カナ)をまとめて入れる画面。
// あいうえお順に並べるためと、銀行明細の振込人名を突き合わせるために使う。
// 54件を1件ずつカードから入れるのは手間なので、この画面で一気に入れられるようにする。
//
// GET  /api/yomi        … 入力用の画面
// GET  /api/yomi?json=1 … 現在の状態
// POST /api/yomi        … {id, kana} を保存(1件ずつ)
const { requireSession, recordedBy } = require('./_auth');
const { db, fail, ok } = require('./_db');
const { guess } = require('./_yomi_dict');

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// 入力を整える。全角カナに寄せ、空白と記号を落とす(名寄せと同じ形にしておく)
function tidy(s) {
  return String(s || '').normalize('NFKC')
    .replace(/[\s　]/g, '')
    .replace(/[.,･・ｰ]/g, '')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)) // ひらがな→カタカナ
    .trim();
}
const KANA_ONLY = /^[ァ-ヺー]+$/;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function listContracts(sql) {
  const rows = await sql(
    `SELECT id, name, car, kana, monthly_amount FROM contract ORDER BY id`);
  return rows.map((r) => {
    const g = guess(r.name);
    return { ...r, 下書き: r.kana ? '' : g.読み, 確か: g.確か, 理由: g.理由,
             登録済み: !!r.kana };
  });
}

const PAGE = (rows) => {
  const done = rows.filter((r) => r.登録済み).length;
  // 同じ読みになる方に目印を出す(苗字だけだと重なるため)
  const count = {};
  rows.forEach((r) => { const k = r.kana || r.下書き; if (k) count[k] = (count[k] || 0) + 1; });
  // 並びは読みの順。入れながら「あいうえお順になっていく」のが見えるようにする
  const sorted = rows.slice().sort((a, b) =>
    String(a.kana || a.下書き || 'ん').localeCompare(String(b.kana || b.下書き || 'ん'), 'ja')
    || a.id - b.id);

  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>よみ(カナ)を入れる</title>
<style>
 :root{--paper:#FBFAF7;--paper-2:#F3F1EB;--ink:#16181A;--ink-2:#5A5F63;--ink-3:#8A8F93;
   --rule:#D9D5CB;--rule-strong:#A9A399;--indigo:#1F3A5F;--paid:#2F5D4A;--overdue:#8C2F26;
   --draft:#8A6D1F;--draft-bg:#FBF4DF;
   --sans:"Hiragino Kaku Gothic ProN","Yu Gothic Medium","Noto Sans JP","Meiryo",sans-serif;}
 *{box-sizing:border-box}body{margin:0;background:var(--paper-2);color:var(--ink);font-family:var(--sans);font-size:15px}
 .sheet{max-width:900px;margin:0 auto;background:var(--paper);min-height:100vh;padding:20px}
 h1{font-size:19px;letter-spacing:.12em;margin:0 0 4px}
 .lead{font-size:13.5px;color:var(--ink-2);line-height:1.8;margin:0 0 18px}
 .row{display:grid;grid-template-columns:34px 1fr 200px 1fr;gap:12px;align-items:center;
   padding:9px 4px;border-bottom:1px solid var(--rule)}
 .head{font-size:12px;color:var(--ink-2);letter-spacing:.08em;border-bottom:1px solid var(--rule-strong)}
 .nm{font-weight:600}.sub{font-size:12.5px;color:var(--ink-2)}
 input{font-family:inherit;font-size:16px;width:100%;padding:7px 9px;
   border:1px solid var(--rule-strong);border-radius:2px;background:#fff}
 input:focus{outline:2px solid var(--indigo);outline-offset:1px}
 input.draft{background:var(--draft-bg);border-color:var(--draft)}
 .st{font-size:12.5px;line-height:1.6}
 .ok{color:var(--paid);font-weight:600}.warn{color:var(--overdue)}.dr{color:var(--draft)}
 .bar{position:sticky;top:0;background:var(--paper);padding:12px 0;border-bottom:2px solid var(--indigo);
   display:flex;gap:12px;align-items:center;flex-wrap:wrap;z-index:5}
 .note{font-size:12px;color:var(--ink-3);line-height:1.8;margin-top:16px}
 .legend{font-size:12.5px;color:var(--ink-2);background:var(--draft-bg);border-left:3px solid var(--draft);
   padding:10px 12px;line-height:1.8;margin:0 0 14px}
</style></head><body><div class="sheet">
<h1>よみ(カナ)を入れる</h1>
<p class="lead">お客さんを<b>あいうえお順に並べる</b>ためと、<b>銀行明細の振込人名と突き合わせる</b>ために使います。<br>
苗字だけで結構です。<b>1件ずつ、その場で保存されます。</b></p>
<p class="legend"><b>色のついた欄は下書きです。</b>こちらで当てた読みなので、そのままでは保存されていません。
合っていれば欄をクリックして<b>Tabキーか欄の外を押す</b>だけで保存されます。違っていれば直してください。<br>
読みが分かれる苗字（高野・恩地・五島など）は、下書きを出さずに印をつけています。</p>
<div class="bar"><b id="done">${done}</b>件 保存済み / 全${rows.length}件<span class="sub" id="msg"></span></div>
<div class="row head"><span>ID</span><span>お名前</span><span>よみ（カナ）</span><span>状態</span></div>
${sorted.map((r) => {
  const v = r.kana || r.下書き;
  const dup = v && count[v] > 1;
  return `<div class="row" data-id="${r.id}">
  <span class="sub">${r.id}</span>
  <span><span class="nm">${esc(r.name)}</span> <span class="sub">${esc(r.car || '')}</span></span>
  <span><input value="${esc(v)}" data-draft="${r.登録済み ? '0' : (r.下書き ? '1' : '0')}"
    class="${!r.登録済み && r.下書き ? 'draft' : ''}" placeholder="カナで入れてください"></span>
  <span class="st">${
    r.登録済み ? '<span class="ok">保存済み</span>'
    : (r.理由 ? `<span class="warn">${esc(r.理由)}</span>`
             : '<span class="dr">下書き（確かめてください）</span>')
  }${dup ? `<br><span class="warn">同じ読みの方が ${count[v]}名 います</span>` : ''}</span>
</div>`;
}).join('')}
<p class="note">※ 下の名前まで入れると、銀行明細の突き合わせがより正確になります（同じ苗字の方が複数いるとき、
金額が同じだと機械では決めきれないため）。まずは苗字だけで結構です。あとから入れ直せます。<br>
※ ひらがなで入れても、カタカナに直して保存します。保存のたびに記録が残ります（消えません）。<br>
※ 入れ終わったら <a href="/">台帳に戻る</a>。</p>
</div>
<script>
const msg=document.getElementById('msg'), doneEl=document.getElementById('done');
async function send(inp){
  const row=inp.closest('.row'), id=+row.dataset.id, v=inp.value.trim();
  if(!v) return;
  if(inp.dataset.saved===v) return;              // 変わっていなければ送らない
  msg.textContent='保存中…';
  const r=await fetch('/api/yomi',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id, kana:v})}).then(r=>r.json()).catch(()=>({error:'通信に失敗しました'}));
  if(r.error){ msg.textContent='失敗: '+(r.理由||r.error); return; }
  inp.value=r.よみ; inp.dataset.saved=r.よみ; inp.dataset.draft='0'; inp.classList.remove('draft');
  row.querySelector('.st').innerHTML='<span class="ok">保存済み</span>';
  doneEl.textContent=r.保存済み件数; msg.textContent='';
}
// 下書きのまま欄を離れたときも保存する(「合っていればTabだけ」を成り立たせる)
document.addEventListener('focusout', e=>{ if(e.target.tagName==='INPUT') send(e.target); });
document.addEventListener('change',  e=>{ if(e.target.tagName==='INPUT') send(e.target); });
document.addEventListener('keydown', e=>{
  if(e.key==='Enter' && e.target.tagName==='INPUT'){
    e.preventDefault();
    const all=[...document.querySelectorAll('input')], i=all.indexOf(e.target);
    if(all[i+1]) all[i+1].focus(); else e.target.blur();
  }
});
</script></body></html>`;
};

module.exports = async (req, res) => {
  if (!requireSession(req, res)) return;
  const method = (req.method || 'GET').toUpperCase();
  try {
    const sql = db();

    if (method === 'GET') {
      const rows = await listContracts(sql);
      if ((req.url || '').includes('json=1')) return ok(res, { 契約: rows });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=UTF-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return res.end(PAGE(rows));
    }

    if (method === 'POST') {
      const who = recordedBy(req);
      const b = await readBody(req);
      const id = Number(b.id);
      const kana = tidy(b.kana);
      if (!id) { res.statusCode = 400; return res.end(JSON.stringify({ error: '契約が指定されていません。' })); }
      if (!kana) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'よみを入れてください。' })); }
      if (!KANA_ONLY.test(kana)) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'よみはカナで入れてください。', 理由: `「${b.kana}」は読み取れません` }));
      }
      const c = (await sql('SELECT id, name, kana FROM contract WHERE id=$1', [id]))[0];
      if (!c) { res.statusCode = 404; return res.end(JSON.stringify({ error: '契約が見つかりません。' })); }

      if (c.kana !== kana) {
        await sql(`UPDATE contract SET kana=$1, updated_at=now() WHERE id=$2`, [kana, id]);
        await sql(`INSERT INTO event (contract_id,no,recorded_by,kind,text,memo)
                   VALUES ($1,NULL,$2,'メモ',$3,NULL)`,
          [id, who, c.kana ? `よみを「${c.kana}」から「${kana}」に直した`
                           : `よみを「${kana}」として登録した`]);
      }
      const n = (await sql(`SELECT count(*)::int AS n FROM contract WHERE kana IS NOT NULL AND kana <> ''`))[0];
      return ok(res, { done: true, 契約: id, よみ: kana, 保存済み件数: n.n });
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ error: '対応していない操作です。' }));
  } catch (e) {
    fail(res, e, 'yomi');
  }
};
