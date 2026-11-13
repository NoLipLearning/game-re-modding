#!/bin/bash
# Puts the page and the built engine together in web/dist, ready to serve.
set -euo pipefail
zh="$(cd "$(dirname "$0")/.." && pwd)"
build="${1:-$zh/engine/build/webgpu/GeneralsMD}"
rm -rf "$zh/web/dist" && mkdir -p "$zh/web/dist"
cp -r "$zh/web/index.html" "$zh/web/style.css" "$zh/web"/*.js "$zh/web/fonts" "$zh/web/dist/"
cp "$build"/GeneralsXZH.js "$build"/GeneralsXZH.wasm "$zh/web/dist/"
[ -f "$build/GeneralsXZH.data" ] && cp "$build/GeneralsXZH.data" "$zh/web/dist/" || true
echo "Assembled $zh/web/dist — run: (cd $zh/server && npm start)"
