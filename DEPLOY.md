# Vercel での表示手順

入金台帳のモック(`引き継ぎ資料/nyukin-daicho.html` と同一内容の `assets/ledger.html`)を、
簡易認証つきで Vercel に表示するための構成。

## 何が入っているか

| ファイル | 役割 |
|---|---|
| `assets/ledger.html` | 表示する台帳モック本体(実データ入り)。静的URLとしては公開されない |
| `api/gate.js` | すべてのリクエストを受ける認証ゲート。認証が通ったときだけ台帳を返す |
| `vercel.json` | 全パス(`/.*`)を `api/gate.js` に集約するルート設定 |

## 認証(重要)

- ひとまずの簡易認証。**ユーザー名 `a` / パスワード `a`** でログインできる。
- ブラウザ標準のログイン画面(Basic 認証)が出る。
- 認証が通るまで HTML は一切返らないため、ソースを見ても実データは覗けない。

### これは暫定である

- ID/パスワードがコード内に固定されている。誰でもこのリポジトリを読めれば分かる。
- 本運用の前に、次のどちらかへ移行すること。
  - パスワードを Vercel の環境変数に移し、`api/gate.js` から読む
  - Vercel の Deployment Protection(Password Protection / Vercel Authentication)を使う

## 表示のしかた

### A. GitHub 連携(推奨・恒久)

1. Vercel でこのリポジトリを Import する
2. デプロイ対象ブランチを選ぶ(このブランチ、または main へマージ後の main)
3. 以後、push するたびに自動でデプロイされる

フレームワークは「Other」。ビルド設定は `vercel.json` が持つのでそのままでよい。

### B. 直接デプロイ(単発)

Vercel CLI がある場合:

```
vercel deploy            # プレビュー
vercel deploy --prod     # 本番
```

## 注意

- 実顧客の氏名・債務額・滞納状況を含む。公開範囲に注意すること。
- 検索インデックスには載らないよう `X-Robots-Tag: noindex` を付けている。
