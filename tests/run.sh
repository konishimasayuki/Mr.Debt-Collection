#!/usr/bin/env bash
# 検査をまとめて走らせる。事前に tests/server.mjs を上げておくこと
set -u
cd "$(dirname "$0")/.."
出す () { echo "===== $1 ====="; node "$1" 2>&1 | grep -E "NG|失敗|すべて通った|Error:|Timeout" | head -8; }

# APIの検査（自分で中身を空にする）
for f in tests/t-bmove.js; do 出す "$f"; done

# 画面の検査（狙った形を作ってから）
node tests/bm-seed.mjs >/dev/null 2>&1; 出す tests/t-bmoveui.mjs
node tests/bc-seed.mjs >/dev/null 2>&1; 出す tests/t-bcountui.mjs
