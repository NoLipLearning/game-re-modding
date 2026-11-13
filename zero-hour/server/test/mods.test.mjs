import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { startServer } from "../server.mjs";
import { isStockArchiveName } from "../mods.mjs";

const big = (extra = "") => Buffer.concat([Buffer.from("BIGF"), Buffer.alloc(12), Buffer.from(extra)]);
async function withServer(run, options = {}) {
  const modsDir = mkdtempSync(join(tmpdir(), "zh-mods-"));
  const { http, port } = await startServer({
    port: 0, webRoot: mkdtempSync(join(tmpdir(), "zh-")), modsDir, uploadKey: "secret", ...options,
  });
  const at = (path) => `http://127.0.0.1:${port}/api/rooms/${path}`;
  const put = (path, body, key = "secret") =>
    fetch(at(path), { method: "PUT", body, headers: { "X-Upload-Key": key } });
  try { await run({ at, put, modsDir }); } finally { http.close(); }
}

test("a shared mod can be listed and downloaded by anyone in the room", () => withServer(async ({ at, put }) => {
  const body = big("my mod");
  const up = await put("game1/mods/!MyMod.big", body);
  assert.equal(up.status, 201);
  const list = await (await fetch(at("game1/mods"))).json();
  assert.deepEqual(list, [{ name: "!MyMod.big", size: body.length, sha256: createHash("sha256").update(body).digest("hex") }]);
  const down = await fetch(at("game1/mods/!MyMod.big"));
  assert.deepEqual(Buffer.from(await down.arrayBuffer()), body);
  assert.deepEqual(await (await fetch(at("other/mods"))).json(), []);
}));

test("uploading and removing need the upload key", () => withServer(async ({ at, put }) => {
  assert.equal((await put("game1/mods/A.big", big(), "wrong")).status, 401);
  assert.equal((await put("game1/mods/A.big", big())).status, 201);
  assert.equal((await fetch(at("game1/mods/A.big"), { method: "DELETE" })).status, 401);
  const gone = await fetch(at("game1/mods/A.big"), { method: "DELETE", headers: { "X-Upload-Key": "secret" } });
  assert.equal(gone.status, 200);
  assert.equal((await fetch(at("game1/mods/A.big"))).status, 404);
}));

test("rejects the original game's archives, non-archives, bad names and oversize files", () =>
  withServer(async ({ at, put, modsDir }) => {
    assert.equal((await put("game1/mods/INIZH.big", big())).status, 400);
    assert.equal((await put("game1/mods/W3DEnglishZH.big", big())).status, 400);
    assert.equal((await put("game1/mods/Mod.big", Buffer.from("this is not an archive"))).status, 400);
    assert.equal((await put("game1/mods/..%2Fevil.big", big())).status, 400);
    assert.equal((await put("game1/mods/Mod.exe", big())).status, 400);
    assert.equal((await put("Bad%20Room/mods/Mod.big", big())).status, 400);
    assert.equal((await put("game1/mods/Huge.big", big("x".repeat(200)))).status, 413);
    assert.deepEqual(await (await fetch(at("game1/mods"))).json(), []);
    const left = readdirSync(modsDir).flatMap((room) => readdirSync(join(modsDir, room)));
    assert.deepEqual(left, [], "no partial uploads left behind");
  }, { maxModBytes: 100 }));

test("replacing a mod keeps one copy and the room total is capped", () => withServer(async ({ at, put, modsDir }) => {
  await put("game1/mods/A.big", big("one"));
  await put("game1/mods/a.big", big("two!"));
  const list = await (await fetch(at("game1/mods"))).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].size, 20);
  assert.equal(readdirSync(join(modsDir, "game1")).length, 2); // index.json + one archive
  assert.equal((await put("game1/mods/B.big", big("x".repeat(30)))).status, 413);
}, { maxRoomModBytes: 60 }));

test("recognises stock archive names but not mod names", () => {
  for (const name of ["INIZH.big", "w3dzh.big", "Music.big", "SpeechGermanZH.big", "English.big", "gensec.big"]) {
    assert.ok(isStockArchiveName(name), name);
  }
  for (const name of ["!MyMod.big", "ZZ_Maps.big", "ShockWave.big", "00INI.big"]) {
    assert.ok(!isStockArchiveName(name), name);
  }
});
