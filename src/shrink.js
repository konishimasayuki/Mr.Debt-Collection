// 画面の写しを、送れる大きさにしてから渡す。
//
// スマホのスクリーンショットはそのままだと数MBある。
// サーバーは1回の送信を4.5MBまでしか通さないので、何枚も付けられない。
// ここで長辺1600pxまで小さくしてJPEGにすると、1枚は数百KBに収まる。
// 1600pxあれば、写した画面の文字は読める。
//
// 一覧に並べる小さい版（長辺320px）も一緒に作る。
// 一覧で原寸を何枚も読ませると、そこで待たされる。

const 原寸の長辺 = 1600;
const 小さい版の長辺 = 320;
const 原寸の品質 = 0.85;
const 小さい版の品質 = 0.8;

// 1枚の上限。サーバー側でも同じところで止めている
export const 一枚の上限 = 1.6 * 1024 * 1024;
export const 上限枚数 = 8;

function 読み込む(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像として読めませんでした。')); };
    img.src = url;
  });
}

// 長辺を 上限 に収めて描き直し、base64 の文字列だけを返す
function 描く(img, 上限, 品質) {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const 倍率 = Math.min(1, 上限 / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * 倍率));
  const h = Math.max(1, Math.round(h0 * 倍率));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  // 透けている部分は白で塗る。JPEGに透過は無く、塗らないと黒くなる
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  const url = c.toDataURL('image/jpeg', 品質);
  return { データ: url.slice(url.indexOf(',') + 1), 幅: w, 高さ: h };
}

// 1枚を送れる形にする。{名前, 種類, データ, 小, 幅, 高さ}
export async function 縮める(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error(`「${(file && file.name) || 'このファイル'}」は画像ではありません。`);
  }
  const img = await 読み込む(file);
  const 大 = 描く(img, 原寸の長辺, 原寸の品質);
  const 小 = 描く(img, 小さい版の長辺, 小さい版の品質);
  if (大.データ.length > 一枚の上限) {
    throw new Error(`「${file.name || '画像'}」は小さくしても大きすぎます。`);
  }
  return {
    名前: String(file.name || '画面の写し').slice(0, 120),
    種類: 'image/jpeg',
    データ: 大.データ, 小: 小.データ,
    幅: 大.幅, 高さ: 大.高さ,
    // 画面に出す見本。送るときには使わない
    見本: `data:image/jpeg;base64,${小.データ}`,
  };
}

// 送るときは、見本を落として中身だけ渡す
export const 送る形 = (g) => ({ 名前: g.名前, 種類: g.種類, データ: g.データ, 小: g.小 });
