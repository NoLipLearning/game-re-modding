#!/bin/bash
# Puts the page and the built engine together in web/dist, ready to serve.
set -euo pipefail
zh="$(cd "$(dirname "$0")/.." && pwd)"
# Uses a fresh engine build when there is one, otherwise the committed prebuilt copy.
build="${1:-$zh/engine/build/webgpu/GeneralsMD}"
[ -f "$build/GeneralsXZH.wasm" ] || build="$zh/prebuilt"
rm -rf "$zh/web/dist" && mkdir -p "$zh/web/dist"
cp -r "$zh/web/index.html" "$zh/web/style.css" "$zh/web"/*.js "$zh/web/fonts" "$zh/web/dist/"
cp "$build"/GeneralsXZH.js "$build"/GeneralsXZH.wasm "$zh/web/dist/"
[ -f "$build/GeneralsXZH.data" ] && cp "$build/GeneralsXZH.data" "$zh/web/dist/" || true
# The server sends these smaller copies to browsers that accept gzip.
gzip -9 -k -f "$zh/web/dist/GeneralsXZH.wasm" "$zh/web/dist/GeneralsXZH.js"
echo "Assembled $zh/web/dist — run: (cd $zh/server && npm start)"
