# Zero Hour in the browser

Goal: Zero Hour playable in a browser tab, with internet multiplayer and uploadable mods.

## Layout

- `engine/` — the game engine, GPL-3.0. See [`engine/UPSTREAM.md`](engine/UPSTREAM.md).
- `web/` — our page: picks the player's game folders and mods, sets the multiplayer room, starts the engine.
- `server/` — serves the page and relays multiplayer traffic between players in a room.
- `tools/` — build preparation and bundling scripts.

## Build and run

Needs Emscripten 7, CMake, Ninja and Node 22.

```bash
tools/setup-build.sh          # once: vcpkg and the WebGPU port, into ~/zh-deps
export EMSCRIPTEN_ROOT=/opt/emsdk/upstream/emscripten VCPKG_ROOT=~/zh-deps/vcpkg
cmake -S engine --preset webgpu \
  -DGENERALSX_EMDAWNWEBGPU_PORT=$HOME/zh-deps/emdawnwebgpu_pkg/emdawnwebgpu.port.py
ninja -C engine/build/webgpu z_generals
tools/assemble-web.sh         # page + engine -> web/dist
(cd server && npm install && npm start)   # http://localhost:8080
```

Open the page in Chrome or Edge, choose your Zero Hour and Generals install folders, and press Play.
Away from `localhost` the page must be served over HTTPS.

## Status

Verified in headless Chromium with stand-in archives: the engine compiles, the page loads it,
creates the WebGPU canvas, and the engine opens archives through the on-demand file reader.
The relay passes its tests, including two WebSocket clients exchanging a packet in a room.

Not yet verified: anything that needs the real game files — menus, a skirmish, a multiplayer
match, mods, performance.

## Roadmap

1. Run with real game files and fix what breaks.
2. Two-player match through the relay over the internet.
3. Mod sharing: upload a mod once, everyone in the room gets it.
4. Performance work.

## Game files

The engine needs the original `.big` archives. They are EA's and are never
committed or served from here; each player supplies their own copy.
