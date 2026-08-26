// 画面の検査の土台。Chromium は入れ物にあるものを使う
import { chromium } from '../node_modules/playwright-core/index.mjs';

export const B = 'http://localhost:4321';
let 失敗 = 0;
export const check = (n, c, x) => {
  console.log((c ? '  OK   ' : '  NG   ') + n + (c ? '' : '  ← ' + JSON.stringify(x)));
  if (!c) 失敗++;
};
export const 終わる = async (b) => {
  await b.close();
  console.log(失敗 ? `\n${失敗}件 失敗` : '\nすべて通った');
  process.exit(失敗 ? 1 : 0);
};

export const 開く = () => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// ログインまで済ませた画面を返す
export async function 入る(b, 幅 = 1400, 高 = 1000) {
  const p = await b.newPage({ viewport: { width: 幅, height: 高 } });
  p.on('dialog', (d) => d.accept());
  await p.goto(B, { waitUntil: 'networkidle' });
  await p.fill('input[autocomplete="username"]', 'a');
  await p.fill('input[type="password"]', 'a');
  await p.click('button.btn-main');
  await p.waitForSelector('.tabs', { timeout: 8000 });
  return p;
}
