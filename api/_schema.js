// テーブルの定義。何度実行しても同じ結果になるように書く(IF NOT EXISTS)。
// 順序は引き継ぎ資料の指示どおり:契約 → 支払予定 → 入金 → 充当 → 事象 → 名寄せ辞書 → 約束。
// 金額はすべて円の整数。小数は使わない。

const STATEMENTS = [

  // ── 1. 契約 ────────────────────────────────
  `CREATE TABLE IF NOT EXISTS contract (
     id              serial PRIMARY KEY,
     name            text NOT NULL,
     kana            text,
     car             text,
     tel             text,
     email           text,
     purchase_amount integer,
     fee_amount      integer,
     total_amount    integer NOT NULL,
     monthly_amount  integer NOT NULL CHECK (monthly_amount > 0),
     term_count      integer NOT NULL DEFAULT 48 CHECK (term_count > 0),
     pay_day         integer NOT NULL DEFAULT 27 CHECK (pay_day BETWEEN 1 AND 31),
     start_date      date NOT NULL,
     bonus_months    integer[] NOT NULL DEFAULT '{}',
     bonus_each      integer NOT NULL DEFAULT 0,
     bonus_remaining integer NOT NULL DEFAULT 0,
     balance_diff    integer NOT NULL DEFAULT 0,
     diff_plan       text NOT NULL DEFAULT '未定'
                     CHECK (diff_plan IN ('未定','最終回','均等','別途請求')),
     status          text NOT NULL DEFAULT '通常',
     delivered_on    date,
     memo            text,
     created_at      timestamptz NOT NULL DEFAULT now(),
     updated_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS contract_kana_idx ON contract (kana)`,

  // 督促をとめる。事情のある方に催促を続けないための欄。
  // 理由と、とめた人と、いつまでを必ず残す(黙って消さない)。
  // 既に動いているデータベースにも足せるよう、後から列を追加する形にする。
  `ALTER TABLE contract ADD COLUMN IF NOT EXISTS dunning_reason text`,
  `ALTER TABLE contract ADD COLUMN IF NOT EXISTS dunning_by     text`,
  `ALTER TABLE contract ADD COLUMN IF NOT EXISTS dunning_at     timestamptz`,
  `ALTER TABLE contract ADD COLUMN IF NOT EXISTS dunning_until  date`,

  // ── 2. 支払予定 ─────────────────────────────
  // 予定額は毎月額のみ。ボーナス加算は含めない(ADR-002)
  `CREATE TABLE IF NOT EXISTS schedule (
     id             serial PRIMARY KEY,
     contract_id    integer NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
     no             integer NOT NULL CHECK (no > 0),
     due_date       date NOT NULL,
     planned_amount integer NOT NULL CHECK (planned_amount > 0),
     state          text NOT NULL DEFAULT '未入金',
     UNIQUE (contract_id, no)
   )`,
  `CREATE INDEX IF NOT EXISTS schedule_due_idx ON schedule (due_date)`,

  // ── 3. 入金 ────────────────────────────────
  // 現金は受領日と預入日を別に持つ。import_key で二重取込を弾く
  `CREATE TABLE IF NOT EXISTS payment (
     id           serial PRIMARY KEY,
     contract_id  integer REFERENCES contract(id) ON DELETE SET NULL,
     paid_on      date NOT NULL,
     deposited_on date,
     amount       integer NOT NULL CHECK (amount > 0),
     method       text NOT NULL CHECK (method IN ('振込','現金','その他')),
     receipt_no   text,
     recorded_by  text NOT NULL,
     source       text NOT NULL DEFAULT '手入力',
     import_key   text UNIQUE,
     payer_name   text,
     created_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS payment_contract_idx ON payment (contract_id, paid_on)`,

  // ── 4. 充当 ────────────────────────────────
  // 入金に予定IDを1本だけ持たせない(ADR-003)。まとめ払いを複数の予定へ按分する
  `CREATE TABLE IF NOT EXISTS allocation (
     id          serial PRIMARY KEY,
     payment_id  integer NOT NULL REFERENCES payment(id) ON DELETE CASCADE,
     schedule_id integer REFERENCES schedule(id) ON DELETE SET NULL,
     amount      integer NOT NULL,
     kind        text NOT NULL
                 CHECK (kind IN ('元本','手数料','遅延損害金','値引','相殺','前受','ボーナス'))
   )`,
  `CREATE INDEX IF NOT EXISTS allocation_payment_idx ON allocation (payment_id)`,

  // ── 5. 事象(追記のみ)──────────────────────
  `CREATE TABLE IF NOT EXISTS event (
     id          bigserial PRIMARY KEY,
     contract_id integer NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
     no          integer,
     occurred_at timestamptz NOT NULL DEFAULT now(),
     recorded_by text NOT NULL,
     kind        text NOT NULL,
     text        text NOT NULL,
     memo        text
   )`,
  `CREATE INDEX IF NOT EXISTS event_contract_idx ON event (contract_id, no)`,

  // 書き換えと削除をデータベース側で止める(ADR-005)。
  // 訂正は「取消」の事象を足すことで表す。
  `CREATE OR REPLACE FUNCTION event_append_only() RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION '記録は追記のみです。訂正は「取消」を足してください。';
   END;
   $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS event_no_update ON event`,
  `CREATE TRIGGER event_no_update BEFORE UPDATE OR DELETE ON event
     FOR EACH ROW EXECUTE FUNCTION event_append_only()`,

  // ── 6. 名寄せ辞書 ───────────────────────────
  `CREATE TABLE IF NOT EXISTS payer_alias (
     id              serial PRIMARY KEY,
     normalized_name text NOT NULL UNIQUE,
     contract_id     integer NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
     created_by      text NOT NULL,
     created_at      timestamptz NOT NULL DEFAULT now()
   )`,

  // ── 7. 約束 ────────────────────────────────
  // prev_due_date は約束前の期日。期日を更新しても、もとの日付が消えないようにする
  `CREATE TABLE IF NOT EXISTS promise (
     id            serial PRIMARY KEY,
     contract_id   integer NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
     heard_on      date NOT NULL,
     promised_on   date NOT NULL,
     amount        integer CHECK (amount IS NULL OR amount > 0),
     heard_by      text NOT NULL,
     memo          text,
     prev_due_date date,
     created_at    timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS promise_contract_idx ON promise (contract_id, promised_on)`,
];

module.exports = { STATEMENTS };
