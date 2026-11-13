// Multiplayer relay. The game speaks its LAN protocol (UDP datagrams addressed by
// IPv4 + port) over one WebSocket per bound port. Each socket belongs to a room;
// datagrams never leave the room, so a room behaves like a private LAN.
//
// Wire format (binary, big-endian), as the engine sends it:
//   register: [1][ip:u32][port:u16]
//   datagram: [2][ip:u32][port:u16][payload...]   client→relay: destination, relay→client: source
const REGISTER = 1;
const DATAGRAM = 2;
const BROADCAST_IP = 0xffffffff;
const HEADER = 7;

export const MAX_PAYLOAD = 64 * 1024;
export const MAX_ROOM_SOCKETS = 64;

export function roomNameFrom(value) {
  const name = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9-]{1,32}$/.test(name) ? name : "lobby";
}

export class Relay {
  constructor() {
    this.rooms = new Map(); // room name -> Map("ip:port" -> client)
  }

  // `send(bytes)` delivers one binary message to the client.
  // Returns { receive(bytes), close() } for the transport to call.
  connect(roomName, send) {
    const name = roomNameFrom(roomName);
    const client = { send, key: null };
    const leave = () => {
      const room = this.rooms.get(name);
      if (!room || client.key === null) return;
      if (room.get(client.key) === client) room.delete(client.key);
      if (room.size === 0) this.rooms.delete(name);
      client.key = null;
    };
    return {
      receive: (data) => {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        if (bytes.length < HEADER) return;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const ip = view.getUint32(1, false);
        const port = view.getUint16(5, false);
        if (bytes[0] === REGISTER && bytes.length === HEADER) {
          leave();
          let room = this.rooms.get(name);
          if (!room) this.rooms.set(name, (room = new Map()));
          if (room.size >= MAX_ROOM_SOCKETS) return;
          client.key = `${ip}:${port}`;
          client.ip = ip;
          client.port = port;
          room.set(client.key, client);
        } else if (bytes[0] === DATAGRAM && client.key !== null) {
          if (bytes.length - HEADER > MAX_PAYLOAD) return;
          const room = this.rooms.get(name);
          const out = new Uint8Array(bytes); // copy, then rewrite the header to the source address
          const outView = new DataView(out.buffer);
          outView.setUint32(1, client.ip, false);
          outView.setUint16(5, client.port, false);
          if (ip === BROADCAST_IP) {
            for (const other of room.values()) {
              if (other !== client && other.port === port) other.send(out);
            }
          } else {
            room.get(`${ip}:${port}`)?.send(out);
          }
        }
      },
      close: leave,
    };
  }

  stats() {
    return [...this.rooms].map(([name, room]) => ({ room: name, sockets: room.size }));
  }
}
