// 開始時の初期値入れ(移行の第3段)。
// 54件それぞれが「何回目まで入金済みか」を銀行明細で確認して入れる。
// これを入れないと、初日から全員が未収に見えてしまう(migration.md)。
//
// GET  /api/opening        … 入力用の画面
// GET  /api/opening?json=1 … 現在の状態
// POST /api/opening        … {id, paid_through} を保存
const { requireSession, recordedBy } = require('./_auth');
const { db, fail, ok } = require('./_db');

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// 今日までに期日が来ている回数(入力の目安として出す。確定値ではない)
async function listContracts(sql) {
  return sql(`
    SELECT c.id, c.name, c.car, c.monthly_amount, c.term_count, c.status,
           (SELECT count(*)::int FROM schedule s
             WHERE s.contract_id = c.id AND s.due_date <= current_date) AS 期日到来,
           (SELECT count(*)::int FROM schedule s
             WHERE s.contract_id = c.id AND s.state = '入金済み') AS 入金済み
      FROM contract c
     ORDER BY c.id`);
}

const PAGE = (rows) => `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>開始時の入金実績を入れる</title>
<style>
 :root{--paper:#FBFAF7;--paper-2:#F3F1EB;--ink:#16181A;--ink-2:#5A5F63;--ink-3:#8A8F93;
   --rule:#D9D5CB;--rule-strong:#A9A399;--indigo:#1F3A5F;--paid:#2F5D4A;--overdue:#8C2F26;
   --sans:"Hiragino Kaku Gothic ProN","Yu Gothic Medium","Noto Sans JP","Meiryo",sans-serif;}
 *{box-sizing:border-box}body{margin:0;background:var(--paper-2);color:var(--ink);font-family:var(--sans);font-size:15px}
 .sheet{max-width:920px;margin:0 auto;background:var(--paper);min-height:100vh;padding:20px}
 h1{font-size:19px;letter-spacing:.12em;margin:0 0 4px}
 .lead{font-size:13.5px;color:var(--ink-2);line-height:1.8;margin:0 0 18px}
 .row{display:grid;grid-template-columns:38px 1fr 90px 96px 130px 1fr;gap:12px;align-items:center;
   padding:9px 4px;border-bottom:1px solid var(--rule)}
 .head{font-size:12px;color:var(--ink-2);letter-spacing:.08em;border-bottom:1px solid var(--rule-strong)}
 .nm{font-weight:600}.sub{font-size:12.5px;color:var(--ink-2)}
 .n{font-variant-numeric:tabular-nums;text-align:right}
 input{font-family:inherit;font-size:16px;width:74px;padding:6px 8px;text-align:right;
   border:1px solid var(--rule-strong);border-radius:2px;background:#fff}
 input:focus{outline:2px solid var(--indigo);outline-offset:1px}
 .st{font-size:12.5px}.ok{color:var(--paid);font-weight:600}.warn{color:var(--overdue)}
 .bar{position:sticky;top:0;background:var(--paper);padding:12px 0;border-bottom:2px solid var(--indigo);
   display:flex;gap:12px;align-items:center;flex-wrap:wrap;z-index:5}
 button{font-family:inherit;font-size:15px;font-weight:700;padding:10px 18px;background:var(--indigo);
   color:#fff;border:1px solid var(--indigo);border-radius:2px;cursor:pointer}
 .note{font-size:12px;color:var(--ink-3);line-height:1.7;margin-top:16px}
</style></head><body><div class="sheet">
<h1>開始時の入金実績を入れる</h1>
<p class="lead">通帳・銀行明細を見ながら、<b>何回目まで入金が済んでいるか</b>を入れてください。<br>
右の目安は「今日までに期日が来た回数」です。ぴったり払えている方はその数字のままで結構です。<br>
入れた分は入金として記録され、残りが未収になります。<b>1件ずつ保存されます。</b></p>
<div class="bar"><b id="done">0</b>件 保存済み / 全54件<span class="sub" id="msg"></span></div>
<div class="row head"><span>ID</span><span>お名前</span><span class="n">毎月額</span>
  <span class="n">目安</span><span>入金済みの回数</span><span>状態</span></div>
${rows.map(r => `<div class="row" data-id="${r.id}">
  <span class="sub">${r.id}</span>
  <span><span class="nm">${r.name}</span> <span class="sub">${r.car || ''}</span></span>
  <span class="n">${Number(r.monthly_amount).toLocaleString()}</span>
  <span class="n sub">${r.期日到来}回</span>
  <span><input type="number" min="0" max="${r.term_count}" value="${r.入金済み || r.期日到来}"> / ${r.term_count}</span>
  <span class="st">${r.入金済み ? `<span class="ok">${r.入金済み}回 保存済み</span>` : (r.status !== '通常' ? `<span class="warn">${r.status}</span>` : '')}</span>
</div>`).join('')}
<p class="note">※ この画面は移行のための一度きりの作業です。保存すると、その回数ぶんが「期日までに入金」として記録され、
以降は通常の消し込みに戻ります。入れ直したいときは数字を変えて再度保存してください(記録は追記され、消えません)。</p>
</div>
<script>
const msg=document.getElementById('msg'), doneEl=document.getElementById('done');
let done=${rows.filter(r => r.入金済み).length};
doneEl.textContent=done;
document.addEventListener('change', async e=>{
  const inp=e.target; if(inp.tagName!=='INPUT') return;
  const row=inp.closest('.row'), id=+row.dataset.id;
  const v=+inp.value; msg.textContent='保存中…';
  const r=await fetch('/api/opening',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id, paid_through:v})}).then(r=>r.json()).catch(()=>({error:'通信に失敗'}));
  if(r.error){ msg.textContent='失敗: '+(r.理由||r.error); return; }
  row.querySelector('.st').innerHTML='<span class="ok">'+r.入金済み+'回 保存済み</span>';
  done=r.保存済み件数; doneEl.textContent=done; msg.textContent='';
});
</script></body></html>`;

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
      const { id, paid_through } = await readBody(req);
      const n = Number(paid_through);
      if (!id || !Number.isInteger(n) || n < 0) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: '契約と回数を正しく入れてください。' }));
      }
      const c = (await sql('SELECT * FROM contract WHERE id=$1', [id]))[0];
      if (!c) { res.statusCode = 404; return res.end(JSON.stringify({ error: '契約が見つかりません。' })); }
      if (n > c.term_count) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: `回数は ${c.term_count} 以下で入れてください。` }));
      }

      // いったん全予定を未入金に戻し、先頭n回を入金済みにする(入れ直しに対応)
      await sql(`UPDATE schedule SET state='未入金' WHERE contract_id=$1`, [id]);
      if (n > 0) {
        await sql(`UPDATE schedule SET state='入金済み'
                    WHERE contract_id=$1 AND no <= $2`, [id, n]);
      }
      // 移行時の初期値であることを記録に残す(追記のみ)
      await sql(
        `INSERT INTO event (contract_id, no, recorded_by, kind, text, memo)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, n || 1, who, 'メモ',
         `移行:開始時の入金実績を ${n}回目まで済みとして登録`,
         '銀行明細で確認した初期値(migration.md 手順3)']);

      const saved = await sql(
        `SELECT count(DISTINCT contract_id)::int AS n FROM schedule WHERE state='入金済み'`);
      return ok(res, { done: true, 契約: id, 入金済み: n, 保存済み件数: saved[0].n });
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ error: '対応していない操作です。' }));
  } catch (e) {
    fail(res, e, 'opening');
  }
};
