// Lets the engine read the player's own game files in place, without copying
// gigabytes into memory. Files appear in the engine's virtual filesystem; each
// read is fetched on demand from a worker in 1 MiB blocks and cached.
export const BLOCK = 1 << 20;
const CACHE_BLOCKS = 256; // 256 MiB of recently used blocks

export class FileBridge {
  constructor(workerUrl = new URL("./fileworker.js", import.meta.url)) {
    if (typeof SharedArrayBuffer === "undefined") {
      throw new Error("This page is not cross-origin isolated, so SharedArrayBuffer is unavailable.");
    }
    this.control = new Int32Array(new SharedArrayBuffer(8));
    this.data = new Uint8Array(new SharedArrayBuffer(BLOCK));
    this.worker = new Worker(workerUrl);
    this.worker.postMessage({ type: "init", control: this.control.buffer, data: this.data.buffer });
    this.cache = new Map(); // "id:block" -> Uint8Array, in least-recently-used order
    this.nextId = 1;
  }

  // Blocks the calling thread until the worker has filled the shared buffer.
  readBlock(id, block) {
    const key = id + ":" + block;
    let bytes = this.cache.get(key);
    if (bytes) {
      this.cache.delete(key);
    } else {
      Atomics.store(this.control, 0, 1);
      this.worker.postMessage({ type: "read", id, offset: block * BLOCK, length: BLOCK });
      // The main thread may not sleep (Atomics.wait is forbidden there), so it spins.
      while (Atomics.load(this.control, 0) === 1) { /* waiting for the worker */ }
      if (Atomics.load(this.control, 0) !== 2) throw new Error("Reading a game file failed");
      bytes = this.data.slice(0, Atomics.load(this.control, 1));
      if (this.cache.size >= CACHE_BLOCKS) this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, bytes);
    return bytes;
  }

  read(id, size, target, targetOffset, length, position) {
    const end = Math.min(position + length, size);
    let done = 0;
    while (position < end) {
      const block = Math.floor(position / BLOCK);
      const within = position - block * BLOCK;
      const bytes = this.readBlock(id, block);
      const count = Math.min(bytes.length - within, end - position);
      if (count <= 0) break;
      target.set(bytes.subarray(within, within + count), targetOffset + done);
      done += count;
      position += count;
    }
    return done;
  }

  // Makes `file` (a File the player picked) readable by the engine at `path`.
  mount(FS, path, file) {
    const id = this.nextId++;
    this.worker.postMessage({ type: "add", id, file });
    const slash = path.lastIndexOf("/");
    const dir = path.slice(0, slash) || "/";
    FS.mkdirTree(dir);
    const node = FS.createFile(dir, path.slice(slash + 1), {}, true, false);
    node.usedBytes = file.size; // what stat() and seek-to-end report
    const bridge = this;
    node.stream_ops = {
      ...node.stream_ops,
      read: (stream, buffer, offset, length, position) =>
        bridge.read(id, file.size, buffer, offset, length, position),
      write: () => { throw new FS.ErrnoError(30 /* EROFS */); },
      mmap: () => { throw new FS.ErrnoError(19 /* ENODEV */); },
    };
    return node;
  }
}
