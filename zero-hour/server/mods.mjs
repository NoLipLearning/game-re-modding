// Per-room mod storage. The host uploads a mod archive once; everyone who joins
// the room downloads it automatically before the game starts.
//
//   GET    /api/rooms/<room>/mods          -> [{ name, size, sha256 }]
//   GET    /api/rooms/<room>/mods/<name>   -> the archive
//   PUT    /api/rooms/<room>/mods/<name>   upload   (needs X-Upload-Key)
//   DELETE /api/rooms/<room>/mods/<name>   remove   (needs X-Upload-Key)
import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOM = /^[a-z0-9-]{1,32}$/;
const NAME = /^[A-Za-z0-9!_][A-Za-z0-9 !_.-]{0,59}\.big$/i;
const ROUTE = /^\/api\/rooms\/([^/]+)\/mods(?:\/([^/]+))?$/;

// The original games' own archives are EA's and must not be hosted here.
const LANGUAGES = "english|german|french|spanish|italian|korean|chinese|polish|brazilian|russian";
const STOCK = new RegExp(
  `^(audio|gensec|ini|maps|music|patch|shaders|speech|terrain|textures|w3d|window|gamedata|install_final)?(${LANGUAGES})?(zh)?\\.big$`, "i");

export const isStockArchiveName = (name) => STOCK.test(name);

export class ModStore {
  constructor({ dir, uploadKey, maxFileBytes = 1 << 30, maxRoomBytes = 4 * (1 << 30) }) {
    this.dir = dir;
    this.uploadKey = uploadKey;
    this.maxFileBytes = maxFileBytes;
    this.maxRoomBytes = maxRoomBytes;
    this.busy = new Set(); // "room/name" uploads in progress
  }

  async list(room) {
    try {
      return JSON.parse(await readFile(join(this.dir, room, "index.json"), "utf8"));
    } catch {
      return [];
    }
  }

  async save(room, mods) {
    mods.sort((a, b) => a.name.localeCompare(b.name));
    await writeFile(join(this.dir, room, "index.json"), JSON.stringify(mods));
  }

  authorized(req) {
    const given = Buffer.from(String(req.headers["x-upload-key"] ?? ""));
    const wanted = Buffer.from(this.uploadKey);
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  }

  // Returns false when the URL is not a mod route, so the caller can carry on.
  async handle(req, res, url) {
    const match = ROUTE.exec(url.pathname);
    if (!match) return false;
    const reply = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    let room, name;
    try {
      room = decodeURIComponent(match[1]);
      name = match[2] === undefined ? undefined : decodeURIComponent(match[2]);
    } catch {
      return reply(400, { error: "Bad URL" }), true;
    }
    if (!ROOM.test(room)) return reply(400, { error: "Bad room name" }), true;

    if (name === undefined) {
      if (req.method !== "GET") return reply(405, { error: "Method not allowed" }), true;
      return reply(200, await this.list(room)), true;
    }
    if (!NAME.test(name)) return reply(400, { error: "Mod files must be named like MyMod.big" }), true;
    const key = name.toLowerCase();
    const mods = await this.list(room);
    const existing = mods.find((mod) => mod.name.toLowerCase() === key);

    if (req.method === "GET" || req.method === "HEAD") {
      if (!existing) return reply(404, { error: "No such mod" }), true;
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": existing.size,
        // The address includes the content hash on the client side, so it can be cached.
        "Cache-Control": "no-cache",
        ETag: `"${existing.sha256}"`,
      });
      if (req.method === "HEAD") return res.end(), true;
      createReadStream(join(this.dir, room, existing.sha256)).pipe(res);
      return true;
    }

    if (req.method !== "PUT" && req.method !== "DELETE") return reply(405, { error: "Method not allowed" }), true;
    if (!this.authorized(req)) return reply(401, { error: "Wrong upload key" }), true;

    if (req.method === "DELETE") {
      if (!existing) return reply(404, { error: "No such mod" }), true;
      const rest = mods.filter((mod) => mod !== existing);
      await this.save(room, rest);
      if (!rest.some((mod) => mod.sha256 === existing.sha256)) {
        await rm(join(this.dir, room, existing.sha256), { force: true });
      }
      return reply(200, rest), true;
    }

    if (isStockArchiveName(name)) {
      return reply(400, { error: "That is one of the original game's archives. Only your own mods can be shared." }), true;
    }
    const others = mods.filter((mod) => mod !== existing);
    const room_bytes = others.reduce((sum, mod) => sum + mod.size, 0);
    const limit = Math.min(this.maxFileBytes, this.maxRoomBytes - room_bytes);
    const declared = Number(req.headers["content-length"]);
    if (declared > limit) return reply(413, { error: "Too large for this room" }), true;
    const busyKey = room + "/" + key;
    if (this.busy.has(busyKey)) return reply(409, { error: "That mod is already being uploaded" }), true;
    this.busy.add(busyKey);

    await mkdir(join(this.dir, room), { recursive: true });
    const temp = join(this.dir, room, `upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const hash = createHash("sha256");
      const out = createWriteStream(temp);
      let size = 0, head = Buffer.alloc(0), problem = null;
      for await (const chunk of req) {
        if (problem) continue; // drain the rest so the client can read our answer
        size += chunk.length;
        if (head.length < 4) head = Buffer.concat([head, chunk]).subarray(0, 4);
        if (size > limit) { problem = [413, "Too large for this room"]; continue; }
        if (head.length === 4 && !["BIGF", "BIG4"].includes(head.toString("latin1"))) {
          problem = [400, "Not a .big archive"]; continue;
        }
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((drained) => out.once("drain", drained));
      }
      await new Promise((closed) => out.end(closed));
      if (!problem && size < 16) problem = [400, "Not a .big archive"];
      if (problem) return reply(problem[0], { error: problem[1] }), true;

      const sha256 = hash.digest("hex");
      await rename(temp, join(this.dir, room, sha256));
      // Re-read: another upload to this room may have finished meanwhile.
      const now = (await this.list(room)).filter((mod) => mod.name.toLowerCase() !== key);
      now.push({ name, size, sha256 });
      await this.save(room, now);
      if (existing && existing.sha256 !== sha256 && !now.some((mod) => mod.sha256 === existing.sha256)) {
        await rm(join(this.dir, room, existing.sha256), { force: true });
      }
      return reply(201, now), true;
    } finally {
      this.busy.delete(busyKey);
      await rm(temp, { force: true });
    }
  }
}
