#!/bin/bash
# One-time preparation for building the engine to WebAssembly on a machine whose
# proxy allows git reads of github.com but not release/archive downloads.
# Creates, under $DEPS (default ~/zh-deps):
#   vcpkg/              with vcpkg_from_github replaced by a git-based fetch
#   emdawnwebgpu_pkg/   Emscripten's WebGPU port, built from Dawn source
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
DEPS="${DEPS:-$HOME/zh-deps}"
EMSCRIPTEN_ROOT="${EMSCRIPTEN_ROOT:-/opt/emsdk/upstream/emscripten}"
# Must match _VERSION in $EMSCRIPTEN_ROOT/tools/ports/emdawnwebgpu.py
DAWN_TAG="${DAWN_TAG:-v20260423.175430}"
mkdir -p "$DEPS"

if [ ! -x "$DEPS/vcpkg/vcpkg" ]; then
  git clone -q https://github.com/microsoft/vcpkg "$DEPS/vcpkg"
  "$DEPS/vcpkg/bootstrap-vcpkg.sh" -disableMetrics
fi
cp "$here/vcpkg_from_github.cmake" "$DEPS/vcpkg/scripts/cmake/vcpkg_from_github.cmake"

if [ ! -f "$DEPS/emdawnwebgpu_pkg/emdawnwebgpu.port.py" ]; then
  [ -d "$DEPS/dawn/.git" ] || GIT_LFS_SKIP_SMUDGE=1 git clone -q --depth 1 --branch "$DAWN_TAG" \
    https://github.com/google/dawn "$DEPS/dawn"
  src="$DEPS/dawn/third_party/emdawnwebgpu/pkg/webgpu/src/webgpu.cpp"
  # Newer libc++ needs <string> spelled out here.
  grep -q '^#include <string>' "$src" || sed -i '0,/^#include <span>/s//#include <span>\n#include <string>/' "$src"
  mkdir -p "$DEPS/dawn/out/wasm"
  (cd "$DEPS/dawn/out/wasm" \
    && "$EMSCRIPTEN_ROOT/emcmake" cmake ../.. -G Ninja -DDAWN_FETCH_DEPENDENCIES=ON -DCMAKE_BUILD_TYPE=Release \
    && ninja emdawnwebgpu_pkg)
  cp -r "$DEPS/dawn/out/wasm/emdawnwebgpu_pkg" "$DEPS/emdawnwebgpu_pkg"
fi

cat <<MSG

Ready. Build the engine with:
  export EMSCRIPTEN_ROOT=$EMSCRIPTEN_ROOT VCPKG_ROOT=$DEPS/vcpkg
  cmake -S engine --preset webgpu -DGENERALSX_EMDAWNWEBGPU_PORT=$DEPS/emdawnwebgpu_pkg/emdawnwebgpu.port.py
  ninja -C engine/build/webgpu z_generals
MSG
