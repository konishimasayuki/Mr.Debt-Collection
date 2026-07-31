// ホーム画面に置くアイコンを作る。外部の画像を持ち込まず、描いて撮る。
// 走らせ方: node tools/icons.mjs
// Playwright の Chromium で描いて撮る。外部の画像を持ち込まないため。
import { chromium } from 'playwright-core';
import fs from 'node:fs';

import { fileURLToPath } from 'node:url';
import path from 'node:path';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
fs.mkdirSync(OUT, { recursive: true });

// 台帳＝紙と罫線。円マークを主にする。余白は maskable のぶんを見て内側に寄せる
const page = (px, 余白) => `
<style>
  html,body{margin:0;width:${px}px;height:${px}px}
  .b{width:${px}px;height:${px}px;background:#1F3A5F;display:flex;
     align-items:center;justify-content:center}
  .p{width:${px - 余白 * 2}px;height:${px - 余白 * 2}px;background:#FBFAF7;
     border-radius:${px * 0.04}px;position:relative;overflow:hidden;
     display:flex;align-items:center;justify-content:center}
  .l{position:absolute;left:0;right:0;height:${Math.max(1, px * 0.008)}px;background:#D9D5CB}
  .y{font:700 ${px * 0.42}px "Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;
     color:#1F3A5F;position:relative;z-index:1;letter-spacing:-.02em}
  .u{position:absolute;left:${px * 0.16}px;right:${px * 0.16}px;bottom:${px * 0.17}px;
     height:${Math.max(2, px * 0.022)}px;background:#8C2F26;z-index:1}
</style>
<div class="b"><div class="p">
  ${[0.3, 0.45, 0.6, 0.75].map((t) => `<span class="l" style="top:${(px - 余白 * 2) * t}px"></span>`).join('')}
  <span class="y">¥</span>
  <span class="u"></span>
</div></div>`;

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
for (const [名, px, 余白] of [
  ['icon-192.png', 192, 10],
  ['icon-512.png', 512, 26],
  ['icon-maskable-512.png', 512, 78],   // まわりを切られても中身が残るように内側へ
  ['apple-touch-icon.png', 180, 0],     // iOS は角を自分で丸めるので余白なし
]) {
  const p = await b.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
  await p.setContent(page(px, 余白));
  await p.screenshot({ path: `${OUT}/${名}`, omitBackground: false });
  await p.close();
  console.log('作った', 名, px);
}
await b.close();
