// 本番と同じ形で動かす。dist を静的に配り、/api は関数へ回す
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import pg from '../node_modules/pg/lib/index.js';
import * as _db from '../api/_db.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const client = new pg.Client(
  { connectionString: 'postgres://postgres@/v2?host=/var/run/postgresql' });
await client.connect();
_db.setDb(async (t, p) => (await client.query(t, p || [])).rows);

const H = {};
for (const n of ['session', 'customers', 'customer', 'payments', 'import', 'companies',
  'setup', 'testcustomer', 'debug', 'debugimage', 'dashboard', 'bank', 'excludes']) {
  H[n] = (await import(`${ROOT}/api/${n}.js`)).default;
}
const MIME = { '.html': 'text/html; charset=UTF-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=UTF-8' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const m = u.pathname.match(/^\/api\/(\w+)$/);
  if (m && H[m[1]]) return H[m[1]](req, res);
  let f = path.join(ROOT, 'dist', u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'dist/index.html');
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
  res.end(fs.readFileSync(f));
}).listen(4321, () => console.log('http://localhost:4321'));
