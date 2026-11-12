# Zero Hour in the browser

Goal: Zero Hour playable in a browser tab, with internet multiplayer and uploadable mods.

## Layout

- `engine/` — the game engine, GPL-3.0. See [`engine/UPSTREAM.md`](engine/UPSTREAM.md).
- `web/` — our own page that loads the engine (not written yet).
- `server/` — multiplayer relay and mod hosting (not written yet).

## Building the engine

Needs Emscripten, CMake, Ninja and a vcpkg checkout.

```bash
export EMSCRIPTEN_ROOT=/opt/emsdk/upstream/emscripten
export VCPKG_ROOT=/path/to/vcpkg
cmake -S engine --preset webgpu
ninja -C engine/build/webgpu z_generals
```

This has not yet been run successfully in the cloud environment.

## Roadmap

1. Build the engine to WebAssembly and serve it locally.
2. Write `web/`: page shell, loading the player's own game files.
3. Internet multiplayer: a WebSocket relay with lobbies in `server/`.
4. Mod upload: a mod is a `.big` archive layered over the base game files.
5. Performance work.

## Game files

The engine needs the original `.big` archives. They are EA's and are never
committed or served from here; each player supplies their own copy.
