# Vercel での公開手順

入金管理台帳(React + Vite の画面 + Vercel の関数 + Neon の PostgreSQL)を
Vercel で動かすための構成。

## 何が入っているか

| | 役割 |
|---|---|
| `index.html` / `src/` | 画面。React + Vite。`npm run build` で `dist/` に出る |
| `api/*.js` | Vercel の関数。1ファイル1エンドポイント。**ESM で書く**(`export default`) |
| `api/_*.js` | 関数から読む共通部品(スキーマ・DB接続・正規化・CSV解析)。エンドポイントではない |
| `api/data/contracts.json` | 旧台帳の54件。載せ替えに使う |
| `vercel.json` | ビルド設定と、`/api/` 以外を `index.html` へ返す書き換え |

`vercel.json` の要点。

- `framework: "vite"` — Import 画面の Application Preset を Vite に固定する。
  書いていないと、自動検出のタイミングによっては「Other」のまま出る
- `buildCommand: npm run build` / `outputDirectory: dist`
- `functions: { "api/*.js": { runtime: "@vercel/node@5.1.10" } }`。
  この版が動くのは **Node 22.x まで**なので、`package.json` の `engines.node` で
  22.x に固定してある。書かないと Vercel の既定(24.x)が使われ、
  「Found invalid Node.js Version」でビルドが止まる
- `/((?!api/).*)` → `/index.html`(画面はタブ切替だけなのでルーターを持たない)
- `X-Robots-Tag: noindex`

## 環境変数

| 名前 | 中身 | 入れないと |
|---|---|---|
| `DATABASE_URL` | Neon の接続文字列 | **APIが全部落ちる** |
| `LEDGER_USER` | ログインの利用者名 | `a` になる |
| `LEDGER_PASS` | ログインのパスワード | `a` になる |
| `SESSION_SECRET` | クッキーの合鍵のもと。長い当てずっぽうの文字列 | 既定値になる |

Vercel の Project → Settings → Environment Variables に入れる。
読んでいるのは `api/_auth.js`(利用者名・パスワード・合鍵)と `api/_db.js`(接続先)。

**`LEDGER_PASS` を入れないと、誰でも `a` / `a` で入れる。**
実顧客の氏名・債務額・滞納状況が入るので、必ず入れること。

合鍵は `SESSION_SECRET` と利用者名・パスワードから作る。
**パスワードを変えると、配ってあるクッキーはその場で使えなくなる**(全員ログインし直し)。
値は16進の文字列にしてある(HTTPヘッダには ASCII しか置けないため)。

環境変数は関数の起動時に読む。**変えたあとは再デプロイすること。**

## 公開のしかた

1. Vercel でこのリポジトリを Import する
2. Application Preset が **Vite** になっていることを確かめる。
   「Other」と出ていたら、そのページを開いたあとに main が進んでいる。
   **ページを読み込み直す**と検出しなおす(`vercel.json` の `framework` で固定してある)
3. 上の環境変数を入れる
4. デプロイ対象ブランチを選ぶ
5. 以後、push するたびに自動でデプロイされる

Vercel CLI があれば `vercel deploy` / `vercel deploy --prod` でもよい。

## 初回にすること

**テーブルの用意と載せ替えは画面に置いていない。** 移行のときに一度使うだけで、
日々使う人の設定タブに置いておくと誤って押されるため。ログインしてから直接叩く。

```
# ログインしてクッキーを取る
curl -c c.txt -X POST https://<your-app>/api/session \
  -H 'Content-Type: application/json' \
  -d '{"user":"<LEDGER_USER>","pass":"<LEDGER_PASS>"}'

# テーブルを作る（何度実行しても同じ結果）
curl -b c.txt -X POST https://<your-app>/api/setup \
  -H 'Content-Type: application/json' -d '{}'

# 旧台帳54件を入れる（氏名で照合して飛ばすので何度実行しても増えない）
curl -b c.txt -X POST https://<your-app>/api/setup \
  -H 'Content-Type: application/json' -d '{"載せ替え":true}'
```

旧台帳を使っていたデータベースなら、`/api/setup` が旧テーブル7つを
`old_ledger` スキーマへ移してから作る(**消さない**)。移したものは応答に出る。

そのあと、画面の**設定タブで債権会社を登録する**。旧台帳に会社の情報が無いため、
登録してから顧客ページで選び直す。

**開始時の入金実績(何回目まで払い終えているか)は 2026-07-31 に入れ済み。**
入れ直しが要るときは `/api/opening` を git の履歴から戻す(`docs/データ保存設計.md`)。

## 手元で動かす

```
npm install
npm run dev        # Vite の開発サーバー(APIは動かない)
npm run build      # dist/ を作る
```

APIまで通して試すときは PostgreSQL を立て、`api/_db.js` の `setDb()` で
接続先を差し替える小さなサーバーを噛ませる。

## 注意

- 実顧客の氏名・債務額・滞納状況を含む。公開範囲に注意すること
- ログインは簡易なもの。担当者ごとの利用者と権限は未実装(`docs/データ保存設計.md` の「先に決めること」)
- HTTPヘッダの値は ASCII しか置けない。日本語を Set-Cookie などに入れない
