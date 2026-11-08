// 検査の土台。APIを本物のPostgreSQLに繋いで呼ぶ。
//
// この一式はリポジトリの中に置いてある。作業場所に置いていたころ、
// 環境ごと消えて全部作り直しになったため。
import pg from '../node_modules/pg/lib/index.js';
import * as _db from '../api/_db.js';
import { SESSION_TOKEN, COOKIE_NAME } from '../api/_auth.js';

export const DB = 'postgres://postgres@/v2?host=/var/run/postgresql';
export const client = new pg.Client({ connectionString: DB });
_db.setDb(async (t, p) => (await client.query(t, p || [])).rows);

const 口 = ['session', 'customers', 'customer', 'payments', 'import', 'companies',
  'setup', 'testcustomer', 'dashboard', 'debug', 'bank', 'excludes'];
const H = {};
for (const n of 口) H[n] = (await import(`../api/${n}.js`)).default;

// APIを直に呼ぶ。HTTPは通さないが、req/res の形は本番と同じ
export function call(name, { method = 'GET', body, q, noauth } = {}) {
  const url = '/api/' + name + (q ? '?' + new URLSearchParams(q) : '');
  const req = { method, url,
    headers: noauth ? {} : { cookie: `${COOKIE_NAME}=${SESSION_TOKEN}` }, body };
  let 済; const p = new Promise((r) => (済 = r));
  const res = {
    statusCode: 200, _h: {},
    // 本物の Node は見出しの名前を小文字でそろえる。ここも合わせる。
    // 合わせないと、検査だけが大文字で書けてしまい、本番と食い違う
    setHeader(k, v) { this._h[String(k).toLowerCase()] = v; },
    end(s) {
      let b = {};
      try { b = JSON.parse(s || '{}'); } catch { /* 本文が無いこともある */ }
      // raw は送ったそのもの（CSVの原本のように、JSONでない返事を見るため）
      済({ code: res.statusCode, body: b, raw: s, headers: res._h });
    },
  };
  H[name](req, res);
  return p;
}

let 失敗 = 0;
export const check = (n, c, x) => {
  console.log((c ? '  OK   ' : '  NG   ') + n + (c ? '' : '  ← ' + JSON.stringify(x)));
  if (!c) 失敗++;
};
export const done = async () => {
  await client.end();
  console.log(失敗 ? `\n${失敗}件 失敗` : '\nすべて通った');
  process.exit(失敗 ? 1 : 0);
};

// 検査のたびに中身を空にする（テーブルは残す）
export async function reset() {
  const ある = async (t) => Number((await client.query(
    `SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename=$1`,
    [t])).rows[0].n) > 0;
  if (!(await ある('event'))) return;
  // 記録は追記のみなので、片づけるあいだだけ止める
  await client.query('ALTER TABLE event DISABLE TRIGGER event_no_update');
  await client.query(`TRUNCATE allocation, payment, promise, payer_alias, payer_exclude,
                               schedule, schedule_memo, event, customer, company
                      RESTART IDENTITY CASCADE`);
  await client.query('ALTER TABLE event ENABLE TRIGGER event_no_update');
  if (await ある('bank_txn')) {
    await client.query('TRUNCATE bank_txn, bank_account RESTART IDENTITY CASCADE');
  }
  if (await ある('debug_ticket')) {
    await client.query('TRUNCATE debug_image, debug_message, debug_ticket RESTART IDENTITY CASCADE');
  }
  // 取り込んだCSVの原本。表を足したら、ここにも足すこと。
  // 足し忘れると、前の回のデータが残って検査が当てにならない
  if (await ある('import_file')) {
    await client.query('TRUNCATE import_file RESTART IDENTITY CASCADE');
  }
}
