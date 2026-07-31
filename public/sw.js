// ホーム画面から開いたときのための、控えめな受け皿。
//
// 決めごと
//  1. /api は絶対にためない。顧客の氏名・債務額が端末に残ると困るし、
//     古い数字を出すくらいなら「つながりません」と言うほうが安全。
//  2. 画面の入れ物（HTML）は毎回ネットを見る。取れなければ、ためた分を出す。
//     ためた分を先に出すと、直したはずの画面が古いまま出続ける。
//  3. ビルドの成果物（/assets/…）は名前に中身の指紋が入っているので、
//     いちど取ったらためて使ってよい。中身が変われば名前も変わる。
//  4. 新しい版が来たら、待たずに入れ替える（skipWaiting / clients.claim）。

const 版 = 'nyukin-v1';

self.addEventListener('install', (e) => {
  // 画面の入れ物だけ先に取っておく。中身（/assets）は使ったときにためる
  e.waitUntil(caches.open(版).then((c) => c.addAll(['/'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== 版) await caches.delete(k);
    await self.clients.claim();
  })());
});

// 画面から「すぐ入れ替えて」と言われたときのため
self.addEventListener('message', (e) => {
  if (e.data === 'すぐ入れ替える') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;   // 1. ためない

  // 2. 画面の入れ物はネット優先
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        const c = await caches.open(版);
        c.put('/', r.clone());
        return r;
      } catch {
        return (await caches.match('/')) || new Response(
          '<meta charset="utf-8"><p style="font-family:sans-serif;padding:24px">'
          + 'つながりませんでした。電波の届くところで開き直してください。</p>',
          { headers: { 'Content-Type': 'text/html; charset=UTF-8' }, status: 503 });
      }
    })());
    return;
  }

  // 3. 指紋つきの成果物とアイコンは、ためた分を先に出す
  e.respondWith((async () => {
    const ためた = await caches.match(req);
    if (ためた) return ためた;
    const r = await fetch(req);
    if (r.ok && (url.pathname.startsWith('/assets/')
      || /\.(png|svg|webmanifest|css|js)$/.test(url.pathname))) {
      (await caches.open(版)).put(req, r.clone());
    }
    return r;
  })());
});
