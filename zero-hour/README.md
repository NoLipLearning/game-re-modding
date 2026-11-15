# Zero Hour in the browser

Goal: Zero Hour playable in a browser tab, with internet multiplayer and uploadable mods.

## Layout

- `engine/` — the game engine, GPL-3.0. See [`engine/UPSTREAM.md`](engine/UPSTREAM.md).
- `web/` — our page: picks the player's game folders and mods, sets the multiplayer room, starts the engine.
- `server/` — serves the page, relays multiplayer traffic between players in a room, and stores the mods shared with each room.
- `tools/` — build preparation and bundling scripts.
- `prebuilt/` — the compiled engine, so the server can be deployed without building it.

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

## Putting it online

The server is one container: page, multiplayer relay and mod storage on one port. It uses
the engine build committed in `prebuilt/`, so the host needs no compiler.

```bash
docker build -t zero-hour zero-hour
docker run -p 8080:8080 -e UPLOAD_KEY=choose-a-key -v zh-mods:/data/mods zero-hour
```

Any host that runs a Dockerfile and supports WebSockets and HTTPS works. For Render, the
`render.yaml` at the repository root describes the service: New → Blueprint → pick this
repository. Render generates the upload key (Environment tab). On its free plan the service
sleeps when idle and shared mods are lost on restart; attach a disk at `/data/mods` to keep them.

If the game stops or shows a black screen, press **Log** in the top right corner: it shows
the engine's last output with a button to copy it.

## Sharing mods

The host enters a room name, adds their mod `.big` files, types the upload key and presses
"Share my mod files with the room". Everyone who opens that room's invite link then gets the
mods automatically when they press Play; each browser downloads a mod only once.

The server prints a random upload key when it starts; set `UPLOAD_KEY` to choose your own.
Mods are stored in `server/mods-data` (`MODS_DIR`), up to 1 GiB per file and 4 GiB per room.
The server refuses files named like the original game's archives.

## Status

Verified in headless Chromium with stand-in archives: the engine compiles, the page loads it,
creates the WebGPU canvas, and the engine opens archives through the on-demand file reader.
The relay passes its tests, including two WebSocket clients exchanging a packet in a room.
Mod sharing: one browser uploads a stand-in archive, a second browser in the same room
downloads it and the engine reads it from its game folder.

The container image builds and serves the page, engine and mod storage.

Not yet verified: anything that needs the real game files — menus, a skirmish, a multiplayer
match, a real mod changing the game, performance.

## Roadmap

1. Run with real game files and fix what breaks.
2. Two-player match through the relay over the internet.
3. Performance work.
4. Check before a match that every player has the same mods.

## Game files

The engine needs the original `.big` archives. They are EA's and are never
committed or served from here; each player supplies their own copy.
