// 連帯保証人・緊急連絡先の画面検査のための土台
import { client, call, reset } from './h.js';
await client.connect();
await reset();
await call('setup', { method: 'POST', body: {} });
const A = (await call('customers', { method: 'POST', body: {
  名前: '保証 太郎', よみ: 'ホショウ タロウ',
  月々の金額: 30000, 回数: 24, 支払日: 27, 開始月: '2026-09',
  保証人名前: '保証 花子', 保証人住所: '福岡県久留米市1-2-3',
  保証人電話番号: '090-1111-2222', 保証人間柄: '母',
  緊急連絡先名前: '連絡 次郎', 緊急連絡先電話番号: '080-3333-4444',
  緊急連絡先間柄: '兄' } })).body;
console.log('顧客id:', A.id);
await client.end();
