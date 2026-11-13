// Runs in a Worker. Answers synchronous read requests from the page for the
// player's own game files, which only a worker may read synchronously.
// Shared state: control = Int32Array [state, bytesRead], data = Uint8Array.
//   state 1 = request pending, 2 = done, 3 = failed
const files = new Map();
const reader = new FileReaderSync();
let control, data;

onmessage = ({ data: msg }) => {
  if (msg.type === "init") {
    control = new Int32Array(msg.control);
    data = new Uint8Array(msg.data);
  } else if (msg.type === "add") {
    files.set(msg.id, msg.file);
  } else if (msg.type === "read") {
    try {
      const file = files.get(msg.id);
      const length = Math.min(msg.length, data.length, Math.max(0, file.size - msg.offset));
      if (length > 0) {
        data.set(new Uint8Array(reader.readAsArrayBuffer(file.slice(msg.offset, msg.offset + length))));
      }
      Atomics.store(control, 1, length);
      Atomics.store(control, 0, 2);
    } catch (error) {
      Atomics.store(control, 0, 3);
    }
  }
};
