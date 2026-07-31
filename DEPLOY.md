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

- `buildCommand: npm run build` / `outputDirectory: dist`
- `functions: { "api/*.js": { runtime: "@vercel/node@5.1.10" } }`
- `/((?!api/).*)` → `/index.html`(画面はタブ切替だけなのでルーターを持たない)
- `X-Robots-Tag: noindex`

## 環境変数

| 名前 | 中身 |
|---|---|
| `DATABASE_URL` | Neon の接続文字列。**必須** |
| `LEDGER_USER` / `LEDGER_PASS` | ログインの利用者名とパスワード |
| `SESSION_SECRET` | クッキーに入れる合鍵のもと |

Vercel の Project → Settings → Environment Variables に入れる。
入れていない場合は開発用の既定値(`a` / `a`)で動くが、**本番では必ず入れること。**

## 公開のしかた

1. Vercel でこのリポジトリを Import する
2. Framework は **Vite**(`vercel.json` があるのでそのままでよい)
3. 上の環境変数を入れる
4. デプロイ対象ブランチを選ぶ
5. 以後、push するたびに自動でデプロイされる

Vercel CLI があれば `vercel deploy` / `vercel deploy --prod` でもよい。

## 初回にすること

ログインして**設定タブ**を開き、上から順に押す。

1. **「テーブルを用意する」** — `POST /api/setup`。何度押しても同じ結果になる
2. **「既存データを載せ替える」** — 旧台帳54件が入る。氏名で照合して飛ばすので何度押しても増えない
3. **債権会社を登録する** — 旧台帳に会社の情報が無いため、登録してから顧客ページで選び直す

**載せ替えただけでは全員が1回目から未入金に見える。**
すでに何回目まで払い終えているかは旧台帳に無い。
運用に乗せる前に、CSV取込か手動入金で過去分を入れること(`docs/データ保存設計.md`)。

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
