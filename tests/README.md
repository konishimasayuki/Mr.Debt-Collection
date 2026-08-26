# 検査

作業場所（scratchpad）に置いていたころ、環境ごと消えて全部作り直しになった。
**この一式はリポジトリの中に置く。**

## 用意

```
pg_ctlcluster 16 main start
createdb -U postgres -h /var/run/postgresql v2
npm install && npm run build
node tests/server.mjs &          # http://localhost:4321
```

`local all all trust` になっていない環境では、`/etc/postgresql/*/main/pg_hba.conf`
の `peer` を `trust` に直して `pg_ctlcluster 16 main reload`。

## 走らせる

```
bash tests/run.sh
```

## 中身

| ファイル | 何をするか |
|---|---|
| `h.js` | APIを本物のPostgreSQLに繋いで直に呼ぶ土台。`reset()` で中身を空にする |
| `ui.js` | 画面の検査の土台。ログインまで済ませた画面を返す |
| `server.mjs` | 本番と同じ形（dist を配り、/api は関数へ）。画面の検査はこれに繋ぐ |
| `rs.mjs` | 中身を空にするだけ |
| `t-*.js` | APIの検査（自分で `reset()` する） |
| `t-*ui.mjs` | 画面の検査（`*-seed.mjs` で状態を作ってから走らせる） |
| `*-seed.mjs` | 画面の検査のための、狙った形の顧客を作る |

## 決めごと

- 検査データの日付は**今日から数える**。決め打ちにすると、その日を過ぎた翌日から落ちる
- 画面の欄は**名前で掴む**（`.f:has(label:text-is("…")) input`）。位置で掴むと、
  欄を1つ足しただけで別の欄を触る
- お金の検査は必ず「1回の予定を超えて充当していない」「入金額より多く充当していない」を見る
