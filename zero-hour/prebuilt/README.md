# Prebuilt engine

`GeneralsXZH.js` and `GeneralsXZH.wasm` are the WebAssembly build of `../engine`
(GPL-3.0, see `../engine/LICENSE.md`), built from this repository at commit
8ed262b with the `webgpu` preset in Release mode. They are here
so the server can be deployed without the Emscripten toolchain. Rebuild with the
steps in `../README.md` and copy the two files here after changing the engine.
They contain no game data.
