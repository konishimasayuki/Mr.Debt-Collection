// ダッシュボード。いま何が回収できていないかを、月ごとに積み上げて見せる。
// GET /api/dashboard
//
// 組み立ては _dash.js に置いてある。開いた直後の往復を減らすため、
// 同じ組み立てを /api/session からも返せるようにしている。
import { requireSession } from './_auth.js';
import { db, fail, ok } from './_db.js';
import { ダッシュボード } from './_dash.js';

export default async (req, res) => {
  if (!requireSession(req, res)) return;
  if ((req.method || 'GET').toUpperCase() !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    return res.end(JSON.stringify({ error: '対応していない操作です。' }));
  }

  try {
    return ok(res, await ダッシュボード(db()));
  } catch (e) {
    fail(res, e, 'dashboard');
  }
};
