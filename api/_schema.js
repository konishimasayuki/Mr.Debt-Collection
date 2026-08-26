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
     -- 取引の状態。値は今も「回収」のまま(車両を引き上げて終わり。督促も請求もしない)。
     -- 画面での呼び名は「引き上げ」にしている。値そのものは変えていない(移行が要らないように)。
     -- 完済はここに入れない。入金から決まるものなので、二重に持つとずれる。
     status          text NOT NULL DEFAULT '通常' CHECK (status IN ('通常','回収')),
     status_date     date,                             -- 引き上げた日
     -- 口座振替（自動引き落とし）の手続きの状態。全員まず「未申込」。
     debit_state     text NOT NULL DEFAULT '未申込'
                     CHECK (debit_state IN ('未申込','口座振替申込','口座振替開始','口座振替停止')),
     debit_date      date,                             -- 申込日 / 開始日
     -- ボーナス払い。月は複数選べる（例 {7,12}）。日と金額は共通
     bonus_months    integer[],
     bonus_day       integer CHECK (bonus_day BETWEEN 1 AND 31),
     bonus_amount    integer CHECK (bonus_amount > 0),
     -- ボーナス払いを始める月。契約の途中から賞与を入れる方がいる。
     -- 空なら契約の初回から（選んだ月が来るたびに作る）。
     bonus_start     date,
     -- ボーナスを何回ぶん作るか。空なら契約の期間に入るだけ全部。
     -- 「7月と12月だが、賞与は6回ぶんだけ」という契約があるため。
     bonus_count     integer CHECK (bonus_count > 0),
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
  `ALTER TABLE customer ADD COLUMN IF NOT EXISTS bonus_months integer[]`,
  `ALTER TABLE customer ADD COLUMN IF NOT EXISTS bonus_day integer`,
  `ALTER TABLE customer ADD COLUMN IF NOT EXISTS bonus_amount integer`,
  `ALTER TABLE customer ADD COLUMN IF NOT EXISTS bonus_start date`,
  `ALTER TABLE customer ADD COLUMN IF NOT EXISTS bonus_count integer`,
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
  // kind でボーナス払いを分ける。通常とボーナスで回次(no)は別に数える
  // （「全48回 + ボーナス4回」と数えるため）。
  `CREATE TABLE IF NOT EXISTS schedule (
     id             serial PRIMARY KEY,
     customer_id    integer NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
     no             integer NOT NULL CHECK (no > 0),
     kind           text NOT NULL DEFAULT '通常' CHECK (kind IN ('通常','ボーナス')),
     due_date       date NOT NULL,
     planned_amount integer NOT NULL CHECK (planned_amount > 0),
     state          text NOT NULL DEFAULT '未入金'
                    CHECK (state IN ('未入金','一部入金','入金済み')),
     -- 督促の連絡をしたか。回ごとに持つ。
     -- 顧客ごとに持つと、次の月になっても「督促済み」のままになり、
     -- かけ忘れた人が分からなくなる。回が変われば、また「未督促」から始まる。
     dunned_at      timestamptz,
     dunned_count   integer NOT NULL DEFAULT 0,
     dunned_by      text,
     -- 督促の記録を取り消した時刻。取り消しても日付と回数は消さずに残す。
     -- 押し間違いを元に戻せるようにするため。ここに時刻が入っていれば「未督促」。
     dunned_undone_at timestamptz,
     UNIQUE (customer_id, kind, no)
   )`,
  `CREATE INDEX IF NOT EXISTS schedule_due_idx ON schedule (due_date)`,
  // すでに作ってあるデータベースにも足す
  `ALTER TABLE schedule ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT '通常'`,
  `ALTER TABLE schedule ADD COLUMN IF NOT EXISTS dunned_at timestamptz`,
  `ALTER TABLE schedule ADD COLUMN IF NOT EXISTS dunned_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE schedule ADD COLUMN IF NOT EXISTS dunned_by text`,
  `ALTER TABLE schedule ADD COLUMN IF NOT EXISTS dunned_undone_at timestamptz`,
  // 一意の決まりを (customer_id, no) から (customer_id, kind, no) へ移す。
  // 移さないと、ボーナス1回目と通常1回目がぶつかって入らない。
  `DO $$
   DECLARE c text;
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='schedule_kind_ck') THEN
       ALTER TABLE schedule ADD CONSTRAINT schedule_kind_ck
         CHECK (kind IN ('通常','ボーナス'));
     END IF;
     SELECT conname INTO c FROM pg_constraint
      WHERE conrelid='schedule'::regclass AND contype='u'
        AND pg_get_constraintdef(oid) = 'UNIQUE (customer_id, no)';
     IF c IS NOT NULL THEN
       EXECUTE format('ALTER TABLE schedule DROP CONSTRAINT %I', c);
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid='schedule'::regclass AND contype='u'
                       AND pg_get_constraintdef(oid) = 'UNIQUE (customer_id, kind, no)') THEN
       ALTER TABLE schedule ADD CONSTRAINT schedule_customer_kind_no_key
         UNIQUE (customer_id, kind, no);
     END IF;
   END $$`,

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
     -- どこから来た入金か。画面で行の色を変えるためと、出所をたどるため
     source       text NOT NULL DEFAULT '手動' CHECK (source IN ('CSV','手動','銀行')),
     ref_no       text,
     payer_name   text,
     memo         text,
     import_key   text UNIQUE,
     -- 入金種類。'通常'(月額)か'ボーナス'を選んで入れた入金は、その種類の回にだけ充てる。
     -- 空なら期日の古い順に種類を問わず充てる（CSV取り込みなど）
     alloc_kind   text,
     recorded_by  text NOT NULL,
     created_at   timestamptz NOT NULL DEFAULT now(),
     updated_at   timestamptz NOT NULL DEFAULT now()
   )`,
  // 列を足すのは索引より先（上の schedule_memo と同じ理由）
  `ALTER TABLE payment ADD COLUMN IF NOT EXISTS alloc_kind text`,
  // すでに作ってあるデータベースの決まりを、銀行APIぶんまで広げる。
  // 古い決まりのままだと、銀行から取り込んだ入金が入らない
  `DO $$
   DECLARE c text;
   BEGIN
     SELECT conname INTO c FROM pg_constraint
      WHERE conrelid='payment'::regclass AND contype='c'
        AND pg_get_constraintdef(oid) LIKE '%source%'
        AND pg_get_constraintdef(oid) NOT LIKE '%銀行%';
     IF c IS NOT NULL THEN
       EXECUTE format('ALTER TABLE payment DROP CONSTRAINT %I', c);
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payment_source_ck') THEN
       ALTER TABLE payment ADD CONSTRAINT payment_source_ck
         CHECK (source IN ('CSV','手動','銀行'));
     END IF;
   END $$`,
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
     kind        text NOT NULL DEFAULT '通常' CHECK (kind IN ('通常','ボーナス')),
     text        text NOT NULL,
     auto        boolean NOT NULL DEFAULT false,   -- 約束などから自動で入ったもの
     promise_id  integer REFERENCES promise(id) ON DELETE SET NULL,  -- どの約束の写しか
     created_by  text NOT NULL,
     created_at  timestamptz NOT NULL DEFAULT now(),
     updated_at  timestamptz NOT NULL DEFAULT now()
   )`,
  // すでに作ってあるデータベースにも足す。
  // 列を足す文は、その列を使う索引よりも必ず先に置く。
  // 索引は名前がすでにあっても中の列を先に見るので、
  // 足す前に索引を作ろうとすると「列が無い」で止まり、足す文まで届かない。
  `ALTER TABLE schedule_memo ADD COLUMN IF NOT EXISTS promise_id integer
     REFERENCES promise(id) ON DELETE SET NULL`,
  // 回の種類。通常とボーナスで回次の番号がぶつかるので、
  // どちらの回のメモかをこの列で分ける（古い分はすべて通常）
  `ALTER TABLE schedule_memo ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT '通常'`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='schedule_memo_kind_ck') THEN
       ALTER TABLE schedule_memo ADD CONSTRAINT schedule_memo_kind_ck
         CHECK (kind IN ('通常','ボーナス'));
     END IF;
   END $$`,
  `CREATE INDEX IF NOT EXISTS schedule_memo_idx
     ON schedule_memo (customer_id, schedule_no, kind, id DESC)`,
  `CREATE INDEX IF NOT EXISTS schedule_memo_promise_idx
     ON schedule_memo (promise_id)`,

  // ── 銀行口座(APIで明細を取りに行く先)────────────
  // 銀行ごとの違いは api/_banks.js の差し込み口に閉じ込める。
  // ここに置くのは「どこから取るか」と「どこまで取ったか」だけ。
  // 合鍵(接続の鍵)はここには入れない。環境変数に置く。
  `CREATE TABLE IF NOT EXISTS bank_account (
     id           serial PRIMARY KEY,
     bank_name    text NOT NULL,              -- 画面に出す銀行名
     branch       text,                       -- 支店名
     last4        text,                       -- 口座番号の下4桁(見分けるためだけ)
     kind         text NOT NULL,              -- どの差し込み口を使うか
     api_ref      text,                       -- 銀行側の口座の識別子
     active       boolean NOT NULL DEFAULT true,
     last_ok_at   timestamptz,                -- 最後に取れた時刻
     last_error   text,                       -- 最後に失敗した理由(取れたら消す)
     created_at   timestamptz NOT NULL DEFAULT now(),
     updated_at   timestamptz NOT NULL DEFAULT now()
   )`,

  // ── 銀行から取ってきた明細(人が確かめる前の置き場)──────
  // 取ってきただけでは入金にしない。必ず人が確認画面を通してから入金にする。
  // 間違った人に入った入金は、黙って入ると誰も気づかないため。
  `CREATE TABLE IF NOT EXISTS bank_txn (
     id          serial PRIMARY KEY,
     account_id  integer NOT NULL REFERENCES bank_account(id) ON DELETE CASCADE,
     -- 銀行側の取引通番。二重に取ってこないための鍵。
     -- 通番を出さない銀行のときは、日付|金額|振込人|同日連番 で作る
     txn_id      text NOT NULL,
     paid_on     date NOT NULL,
     amount      integer NOT NULL CHECK (amount > 0),
     payer_name  text,
     ref_no      text,
     raw         text,                        -- 銀行が返した中身(そのまま)
     -- 未確認 … 取ってきたが、まだ人が見ていない
     -- 取込済み … 入金にした / 見送り … 人が「これは入金ではない」と決めた
     state       text NOT NULL DEFAULT '未確認'
                 CHECK (state IN ('未確認','取込済み','見送り')),
     payment_id  integer REFERENCES payment(id) ON DELETE SET NULL,
     fetched_at  timestamptz NOT NULL DEFAULT now(),
     decided_at  timestamptz,
     decided_by  text,
     UNIQUE (account_id, txn_id)
   )`,
  `CREATE INDEX IF NOT EXISTS bank_txn_state_idx
     ON bank_txn (state, paid_on DESC, id DESC)`,

  // ── 名寄せ辞書(CSVの振込人名 → 顧客)──────────────
  // 取り込まない振込人。ここに入れた名前は、CSVでも銀行でも毎回外す。
  // 会社の口座間の振替や、手数料の戻しなど、お客様の入金ではないもの。
  // 顧客に結び付けない（顧客とは関係のない入金なので）。
  `CREATE TABLE IF NOT EXISTS payer_exclude (
     id              serial PRIMARY KEY,
     normalized_name text NOT NULL UNIQUE,
     raw_name        text NOT NULL,
     memo            text,
     created_by      text NOT NULL,
     created_at      timestamptz NOT NULL DEFAULT now()
   )`,

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
  //
  // 入金が1件も無い顧客の記録も、片づけられるようにする。
  // 追記のみにしているのは「お金の跡を消させない」ため。
  // 1円も受け取っていない顧客には、守るべきお金の跡がない。
  // 登録し間違えた顧客を、いつまでも一覧に残さずに済むようにする。
  `CREATE OR REPLACE FUNCTION event_append_only() RETURNS trigger AS $$
   BEGIN
     IF TG_OP = 'DELETE' AND OLD.customer_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM customer
                     WHERE id = OLD.customer_id AND is_test) THEN
       RETURN OLD;
     END IF;
     IF TG_OP = 'DELETE' AND OLD.customer_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM customer WHERE id = OLD.customer_id)
        AND NOT EXISTS (SELECT 1 FROM payment
                         WHERE customer_id = OLD.customer_id) THEN
       RETURN OLD;
     END IF;
     RAISE EXCEPTION '記録は追記のみです。訂正は「取消」を足してください。';
   END;
   $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS event_no_update ON event`,
  `CREATE TRIGGER event_no_update BEFORE UPDATE OR DELETE ON event
     FOR EACH ROW EXECUTE FUNCTION event_append_only()`,

  // ── デバッグ依頼 ───────────────────────────
  // 使っていて困ったことを、画面からそのまま出せるようにする。
  // 台帳の数字とは関わりが無いので、顧客や入金とは結び付けない。
  // 消せる（記録 event と違って追記のみにしない）。
  // 顧客の名前が写り込んだ画像を間違えて上げたとき、消せないと困る。
  `CREATE TABLE IF NOT EXISTS debug_ticket (
     id         serial PRIMARY KEY,
     title      text NOT NULL,
     body       text,
     state      text NOT NULL DEFAULT '未対応'
                CHECK (state IN ('未対応','対応中','直した')),
     created_by text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS debug_ticket_idx ON debug_ticket (id DESC)`,

  // 返信。依頼を消したら一緒に消える
  `CREATE TABLE IF NOT EXISTS debug_message (
     id         serial PRIMARY KEY,
     ticket_id  integer NOT NULL REFERENCES debug_ticket(id) ON DELETE CASCADE,
     body       text,
     created_by text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS debug_message_idx ON debug_message (ticket_id, id)`,

  // 画像。外の置き場を使わず、ここに入れる。
  // 置き場を増やすと設定と料金がもう1つ増え、動かなくなったときの原因が分かりにくい。
  // 画面側で長辺1600pxまで小さくしてから送るので、1枚は数百KBに収まる。
  // thumb は一覧に並べる小さい版（長辺320px）。一覧で原寸を何枚も読ませない。
  // message_id が NULL なら依頼そのものに付いた画像、入っていれば返信の画像。
  `CREATE TABLE IF NOT EXISTS debug_image (
     id         serial PRIMARY KEY,
     ticket_id  integer NOT NULL REFERENCES debug_ticket(id) ON DELETE CASCADE,
     message_id integer REFERENCES debug_message(id) ON DELETE CASCADE,
     mime       text NOT NULL,
     name       text,
     bytes      bytea NOT NULL,
     thumb      bytea NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS debug_image_idx ON debug_image (ticket_id, id)`,
];

export { STATEMENTS };
