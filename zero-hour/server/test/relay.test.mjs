import { test } from "node:test";
import assert from "node:assert/strict";
import { Relay, roomNameFrom, MAX_PAYLOAD } from "../relay.mjs";

const frame = (type, ip, port, payload = []) => {
  const bytes = new Uint8Array(7 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, type);
  view.setUint32(1, ip, false);
  view.setUint16(5, port, false);
  bytes.set(payload, 7);
  return bytes;
};
const join = (relay, room, ip, port) => {
  const inbox = [];
  const link = relay.connect(room, (bytes) => inbox.push(bytes));
  link.receive(frame(1, ip, port));
  return { inbox, link };
};
const A = 0x0a000001, B = 0x0a000002, C = 0x0a000003;

test("directed datagram reaches only its destination, stamped with the sender", () => {
  const relay = new Relay();
  const a = join(relay, "r", A, 8086), b = join(relay, "r", B, 8086), c = join(relay, "r", C, 8086);
  a.link.receive(frame(2, B, 8086, [9, 8, 7]));
  assert.deepEqual(b.inbox, [frame(2, A, 8086, [9, 8, 7])]);
  assert.equal(a.inbox.length + c.inbox.length, 0);
});

test("broadcast reaches every other socket on that port in the room", () => {
  const relay = new Relay();
  const a = join(relay, "r", A, 8086), b = join(relay, "r", B, 8086), other = join(relay, "r", C, 9999);
  a.link.receive(frame(2, 0xffffffff, 8086, [1]));
  assert.deepEqual(b.inbox, [frame(2, A, 8086, [1])]);
  assert.equal(a.inbox.length + other.inbox.length, 0);
});

test("rooms are isolated from each other", () => {
  const relay = new Relay();
  const a = join(relay, "one", A, 8086), b = join(relay, "two", B, 8086);
  a.link.receive(frame(2, 0xffffffff, 8086, [1]));
  a.link.receive(frame(2, B, 8086, [1]));
  assert.equal(b.inbox.length, 0);
});

test("a socket that has not registered cannot send", () => {
  const relay = new Relay();
  const b = join(relay, "r", B, 8086);
  relay.connect("r", () => {}).receive(frame(2, B, 8086, [1]));
  assert.equal(b.inbox.length, 0);
});

test("closing removes the socket and empties the room", () => {
  const relay = new Relay();
  const a = join(relay, "r", A, 8086), b = join(relay, "r", B, 8086);
  b.link.close();
  a.link.receive(frame(2, B, 8086, [1]));
  assert.equal(b.inbox.length, 0);
  a.link.close();
  assert.deepEqual(relay.stats(), []);
});

test("oversized and truncated messages are dropped", () => {
  const relay = new Relay();
  const a = join(relay, "r", A, 8086), b = join(relay, "r", B, 8086);
  a.link.receive(frame(2, B, 8086, new Uint8Array(MAX_PAYLOAD + 1)));
  a.link.receive(new Uint8Array([2, 0, 0]));
  assert.equal(b.inbox.length, 0);
});

test("room names are normalised and unsafe ones fall back to the lobby", () => {
  assert.equal(roomNameFrom("My-Room1"), "my-room1");
  assert.equal(roomNameFrom("../etc"), "lobby");
  assert.equal(roomNameFrom(undefined), "lobby");
});
