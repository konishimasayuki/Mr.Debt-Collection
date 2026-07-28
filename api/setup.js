// テーブルを作る(何度実行しても安全)。ログインが必要。
// 手元のパソコンからデータベースに接続できないため、この入口から流す。
const { requireSession } = require('./_auth');
const { db, fail, ok } = require('./_db');
const { STATEMENTS } = require('./_schema');

module.exports = async (req, res) => {
  if (!requireSession(req, res)) return;
  try {
    const sql = db();
    for (const stmt of STATEMENTS) {
      await sql.query(stmt);
    }
    // 何ができたかを返す
    const tables = await sql.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' ORDER BY table_name`);
    const counts = {};
    for (const t of tables.map(r => r.table_name)) {
      const c = await sql.query(`SELECT count(*)::int AS n FROM "${t}"`);
      counts[t] = c[0].n;
    }
    ok(res, { done: true, 実行した文: STATEMENTS.length, テーブル: counts });
  } catch (e) {
    fail(res, e, 'setup');
  }
};
