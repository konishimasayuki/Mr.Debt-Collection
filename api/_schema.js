// テーブルの定義。何度実行しても同じ結果になるように書く(IF NOT EXISTS)。
// 金額はすべて円の整数。小数は使わない。日付は日付型。

const STATEMENTS = [

  // ── 債権会社(設定タブで足せる)──────────────────
  // 譲渡会社と譲渡先で同じ会社を選ぶこともあるので、種別で分けずに1つの表にする
  `CREATE TABLE IF NOT EXISTS company (
     id         serial PRIMARY KEY,
     name       text NOT NULL UNIQUE,
     note       text,
     active     boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  // ── 顧客(契約)────────────────────────────
  `CREATE TABLE IF NOT EXISTS customer (
     id              serial PRIMARY KEY,
     name            text NOT NULL,
     kana            text,
     gender          text,
     birthday        date,
     address         text,
     tel             text,
     email           text,
     contract_date   date,
     car             text,
     assignor_id     integer REFERENCES company(id),   -- 債権譲渡会社
     assignee_id     integer REFERENCES company(id),   -- 債権譲渡先
     monthly_amount  integer NOT NULL CHECK (monthly_amount > 0),
     term_count      integer NOT NULL DEFAULT 48 CHECK (term_count > 0),
     pay_day         integer NOT NULL DEFAULT 27 CHECK (pay_day BETWEEN 1 AND 31),
     start_date      date NOT NULL,
     total_amount    integer NOT NULL,
     memo            text,
     -- 取引の状態。回収は「車両を回収して終わり」。督促も請求もしない。
     -- 完済はここに入れない。入金から決まるものなので、二重に持つとずれる。
     status          text NOT NULL DEFAULT '通常' CHECK (status IN ('通常','回収')),
     status_date     date,                             -- 回収した日
     -- 口座振替（自動引き落とし）の手続きの状態。全員まず「未申込」。
     debit_state     text NOT NULL DEFAULT '未申込'
                     CHECK (debit_state IN ('未申込','口座振替申込','口座振替開始','口座振替停止')),
     debit_date      date,                             -- 申込日 / 開始日
     is_test         boolean NOT NULL DEFAULT false,   -- 動作を試すための顧客
     archived        boolean NOT NULL DEFAULT false,
     created_at      timestamptz NOT NULL DEFAULT now(),
     updated_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS customer_kana_idx ON customer (kana)`,
  // すでに作ってあるデータベースにも足す（列を増やしたときはここに書く）
  `ALTER TABLE customer ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false`,
  `ALTER TABLE customer ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT '通常'`,
  `ALTER TABLE customer ADD COLUMN IF NOT EXISTS status_date date`,
  `ALTER TABLE customer ADD COLUMN IF NOT EXISTS debit_state text NOT NULL DEFAULT '未申込'`,
  `ALTER TABLE customer ADD COLUMN IF NOT EXISTS debit_date date`,
  // 制約はあとから足す。すでに列がある場合は CHECK が付いていないため
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='customer_status_ck') THEN
       ALTER TABLE customer ADD CONSTRAINT customer_status_ck
         CHECK (status IN ('通常','回収'));
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='customer_debit_ck') THEN
       ALTER TABLE customer ADD CONSTRAINT customer_debit_ck
         CHECK (debit_state IN ('未申込','口座振替申込','口座振替開始','口座振替停止'));
     END IF;
   END $$`,

  // ── 支払予定 ────────────────────────────
  // 契約登録時に回数ぶん自動生成する。期日は固定で、約束では動かさない。
  `CREATE TABLE IF NOT EXISTS schedule (
     id             serial PRIMARY KEY,
     customer_id    integer NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
     no             integer NOT NULL CHECK (no > 0),
     due_date       date NOT NULL,
     planned_amount integer NOT NULL CHECK (planned_amount > 0),
     state          text NOT NULL DEFAULT '未入金'
                    CHECK (state IN ('未入金','一部入金','入金済み')),
     UNIQUE (customer_id, no)
   )`,
  `CREATE INDEX IF NOT EXISTS schedule_due_idx ON schedule (due_date)`,

  // ── 入金 ─────────────────────────────
  // source で CSV と手動を分ける(画面で行の背景を変えるため)。
  // import_key は二重取込を弾く鍵。CSVの付番は重複しうるので、
  // 日付+付番+金額+同一ファイル内の連番で作る。
  `CREATE TABLE IF NOT EXISTS payment (
     id           serial PRIMARY KEY,
     customer_id  integer REFERENCES customer(id) ON DELETE SET NULL,
     paid_on      date NOT NULL,
     amount       integer NOT NULL CHECK (amount > 0),
     method       text NOT NULL DEFAULT '振込'
                  CHECK (method IN ('振込','現金','その他')),
     source       text NOT NULL DEFAULT '手動' CHECK (source IN ('CSV','手動')),
     ref_no       text,
     payer_name   text,
     memo         text,
     import_key   text UNIQUE,
     recorded_by  text NOT NULL,
     created_at   timestamptz NOT NULL DEFAULT now(),
     updated_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS payment_paid_idx ON payment (paid_on DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS payment_customer_idx ON payment (customer_id, paid_on)`,

  // ── 充当 ─────────────────────────────
  // 1件の入金を複数の回へ按分できるようにする。残高は Σ充当額 で出す。
  `CREATE TABLE IF NOT EXISTS allocation (
     id          serial PRIMARY KEY,
     payment_id  integer NOT NULL REFERENCES payment(id) ON DELETE CASCADE,
     schedule_id integer REFERENCES schedule(id) ON DELETE SET NULL,
     amount      integer NOT NULL CHECK (amount > 0)
   )`,
  `CREATE INDEX IF NOT EXISTS allocation_payment_idx ON allocation (payment_id)`,
  `CREATE INDEX IF NOT EXISTS allocation_schedule_idx ON allocation (schedule_id)`,

  // ── 入金約束(カレンダーから足す)───────────────
  // 1回ぶんに何件でも足せる(3日後に半分・5日後に残り、が日常のため)。
  // until_time が NULL なら終日。
  `CREATE TABLE IF NOT EXISTS promise (
     id           serial PRIMARY KEY,
     customer_id  integer NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
     promised_on  date NOT NULL,
     until_time   time,
     schedule_no  integer,
     amount       integer NOT NULL CHECK (amount > 0),
     memo         text,
     done         boolean NOT NULL DEFAULT false,
     created_by   text NOT NULL,
     created_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS promise_customer_idx ON promise (customer_id, promised_on)`,

  // ── 回ごとのメモ(支払いの記録の各回の下に出る)────────
  // 入金約束を入れた・動かした・取り消したときに自動で1行足す。
  // 記録(event)と違って、あとから直せるし消せる。
  `CREATE TABLE IF NOT EXISTS schedule_memo (
     id          serial PRIMARY KEY,
     customer_id integer NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
     schedule_no integer NOT NULL CHECK (schedule_no > 0),
     text        text NOT NULL,
     auto        boolean NOT NULL DEFAULT false,   -- 約束などから自動で入ったもの
     promise_id  integer REFERENCES promise(id) ON DELETE SET NULL,  -- どの約束の写しか
     created_by  text NOT NULL,
     created_at  timestamptz NOT NULL DEFAULT now(),
     updated_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS schedule_memo_idx
     ON schedule_memo (customer_id, schedule_no, id DESC)`,
  // すでに作ってあるデータベースにも足す
  `ALTER TABLE schedule_memo ADD COLUMN IF NOT EXISTS promise_id integer
     REFERENCES promise(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS schedule_memo_promise_idx
     ON schedule_memo (promise_id)`,

  // ── 名寄せ辞書(CSVの振込人名 → 顧客)──────────────
  `CREATE TABLE IF NOT EXISTS payer_alias (
     id              serial PRIMARY KEY,
     normalized_name text NOT NULL UNIQUE,
     customer_id     integer NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
     created_by      text NOT NULL,
     created_at      timestamptz NOT NULL DEFAULT now()
   )`,

  // ── 記録(追記のみ)──────────────────────
  // 誰が何をいつしたかを消せないようにする。訂正は「取消」を足して表す。
  `CREATE TABLE IF NOT EXISTS event (
     id          bigserial PRIMARY KEY,
     customer_id integer REFERENCES customer(id) ON DELETE CASCADE,
     payment_id  integer,
     occurred_at timestamptz NOT NULL DEFAULT now(),
     recorded_by text NOT NULL,
     kind        text NOT NULL,
     text        text NOT NULL,
     memo        text
   )`,
  `CREATE INDEX IF NOT EXISTS event_customer_idx ON event (customer_id, id DESC)`,

  // 動作を試すための顧客(is_test)の記録だけは、片づけられるようにする。
  // 顧客の行より先に記録を消すこと。顧客を消してから消すと、
  // ここの EXISTS がもう当たらず、追記のみに引っかかる。
  `CREATE OR REPLACE FUNCTION event_append_only() RETURNS trigger AS $$
   BEGIN
     IF TG_OP = 'DELETE' AND OLD.customer_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM customer
                     WHERE id = OLD.customer_id AND is_test) THEN
       RETURN OLD;
     END IF;
     RAISE EXCEPTION '記録は追記のみです。訂正は「取消」を足してください。';
   END;
   $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS event_no_update ON event`,
  `CREATE TRIGGER event_no_update BEFORE UPDATE OR DELETE ON event
     FOR EACH ROW EXECUTE FUNCTION event_append_only()`,
];

export { STATEMENTS };
