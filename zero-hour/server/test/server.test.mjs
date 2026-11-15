import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startServer } from "../server.mjs";

const frame = (type, ip, port, payload = []) => {
  const bytes = Buffer.alloc(7 + payload.length);
  bytes.writeUInt8(type, 0); bytes.writeUInt32BE(ip, 1); bytes.writeUInt16BE(port, 5);
  Buffer.from(payload).copy(bytes, 7);
  return bytes;
};
const open = (port, room) => new Promise((ok, fail) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/GeneralsXLan?room=${room}`);
  ws.on("open", () => ok(ws)); ws.on("error", fail);
});

test("serves files with cross-origin isolation headers and blocks path escape", async () => {
  const root = mkdtempSync(join(tmpdir(), "zh-"));
  writeFileSync(join(root, "index.html"), "<p>hi</p>");
  const { http, port } = await startServer({ port: 0, webRoot: root });
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), "<p>hi</p>");
    assert.equal(page.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(page.headers.get("cross-origin-embedder-policy"), "require-corp");
    const escape = await fetch(`http://127.0.0.1:${port}/..%2f..%2fetc%2fpasswd`);
    assert.notEqual(escape.status, 200);
  } finally { http.close(); }
});

test("two browsers in a room exchange a datagram over WebSocket", async () => {
  const root = mkdtempSync(join(tmpdir(), "zh-"));
  const { http, port } = await startServer({ port: 0, webRoot: root });
  const a = await open(port, "game1"), b = await open(port, "game1");
  try {
    a.send(frame(1, 0x0a000001, 8086));
    b.send(frame(1, 0x0a000002, 8086));
    await new Promise((r) => setTimeout(r, 50));
    const got = new Promise((ok) => b.once("message", ok));
    a.send(frame(2, 0xffffffff, 8086, [42]));
    assert.deepEqual(await got, frame(2, 0x0a000001, 8086, [42]));
    const rooms = await (await fetch(`http://127.0.0.1:${port}/api/rooms`)).json();
    assert.deepEqual(rooms, [{ room: "game1", sockets: 2 }]);
  } finally { a.close(); b.close(); http.close(); }
});

test("sends the pre-compressed copy of a file to clients that accept gzip", async () => {
  const { gzipSync } = await import("node:zlib");
  const root = mkdtempSync(join(tmpdir(), "zh-"));
  writeFileSync(join(root, "big.js"), "let a = 1;".repeat(100));
  writeFileSync(join(root, "big.js.gz"), gzipSync("let a = 1;".repeat(100)));
  const { http, port } = await startServer({ port: 0, webRoot: root });
  try {
    const packed = await fetch(`http://127.0.0.1:${port}/big.js`);
    assert.equal(packed.headers.get("content-encoding"), "gzip");
    assert.equal(packed.headers.get("content-type"), "text/javascript");
    assert.equal(await packed.text(), "let a = 1;".repeat(100));
    const plain = await fetch(`http://127.0.0.1:${port}/big.js`, { headers: { "Accept-Encoding": "identity" } });
    assert.equal(plain.headers.get("content-encoding"), null);
    assert.equal(plain.headers.get("content-length"), "1000");
  } finally { http.close(); }
});
