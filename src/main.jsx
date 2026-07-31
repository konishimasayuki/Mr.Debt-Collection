import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
);

// ホーム画面から開けるようにする受け皿。手元の開発では入れない
// （直したそばから古い画面が出て、原因を探す時間が無駄になるため）。
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // 新しい版が用意できたら、待たせずに入れ替える。
      // デプロイのあとに古い画面が残り続けるのを防ぐ。
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            w.postMessage('すぐ入れ替える');
          }
        });
      });
    }).catch(() => { /* 受け皿が入らなくても、画面は普通に動く */ });

    let 読み直した = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (読み直した) return;
      読み直した = true;
      window.location.reload();
    });
  });
}
