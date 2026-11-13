// Serves the game page and runs the multiplayer relay on one port.
//   PORT        listen port (default 8080)
//   WEB_ROOT    folder with the page and the engine build (default ../web/dist)
//   MODS_DIR    where shared mods are stored (default ./mods-data)
//   UPLOAD_KEY  what a host must enter to share or remove mods (default: random, printed at start)
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Relay, MAX_PAYLOAD } from "./relay.mjs";
import { ModStore } from "./mods.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

export function startServer({
  port = 8080,
  webRoot = resolve(here, "../web/dist"),
  modsDir = resolve(here, "mods-data"),
  uploadKey = randomBytes(9).toString("base64url"),
  maxModBytes,
  maxRoomModBytes,
} = {}) {
  const relay = new Relay();
  const mods = new ModStore({ dir: modsDir, uploadKey, maxFileBytes: maxModBytes, maxRoomBytes: maxRoomModBytes });
  const root = resolve(webRoot);

  const http = createServer(async (req, res) => {
    // SharedArrayBuffer (which the engine's file bridge needs) requires cross-origin isolation.
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/rooms") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      return res.end(JSON.stringify(relay.stats()));
    }
    try {
      if (await mods.handle(req, res, url)) return;
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      return res.end();
    }
    if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405).end();
    let path;
    try {
      path = normalize(join(root, decodeURIComponent(url.pathname)));
    } catch {
      return res.writeHead(400).end();
    }
    if (path !== root && !path.startsWith(root + sep)) return res.writeHead(403).end();
    let stat;
    try {
      stat = statSync(path);
      if (stat.isDirectory()) stat = statSync((path = join(path, "index.html")));
    } catch {
      return res.writeHead(404).end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": TYPES[extname(path)] ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(path).pipe(res);
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD + 64 });
  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/GeneralsXLan") return socket.destroy();
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const link = relay.connect(url.searchParams.get("room"), (bytes) => {
        if (ws.readyState === ws.OPEN) ws.send(bytes);
      });
      ws.on("message", (data, isBinary) => { if (isBinary) link.receive(data); });
      ws.on("close", link.close);
      ws.on("error", link.close);
    });
  });

  return new Promise((ready) => http.listen(port, () => ready({ http, relay, uploadKey, port: http.address().port })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port, uploadKey } = await startServer({
    port: Number(process.env.PORT) || 8080,
    webRoot: process.env.WEB_ROOT || undefined,
    modsDir: process.env.MODS_DIR || undefined,
    uploadKey: process.env.UPLOAD_KEY || undefined,
  });
  console.log(`Zero Hour server on http://localhost:${port}`);
  if (!process.env.UPLOAD_KEY) console.log(`Upload key for sharing mods: ${uploadKey}`);
}
