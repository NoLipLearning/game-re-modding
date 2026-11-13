// Talks to the server's per-room mod storage (server/mods.mjs).
const address = (room, name) =>
  `api/rooms/${encodeURIComponent(room)}/mods` + (name === undefined ? "" : "/" + encodeURIComponent(name));

async function answer(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}`);
  return body;
}

export const listRoomMods = async (room) => answer(await fetch(address(room), { cache: "no-store" }));

export const removeRoomMod = async (room, name, key) =>
  answer(await fetch(address(room, name), { method: "DELETE", headers: { "X-Upload-Key": key } }));

// Uploads one archive; `onProgress` gets a fraction from 0 to 1. Resolves to the room's new list.
export function shareMod(room, name, file, key, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest(); // fetch cannot report upload progress
    request.open("PUT", address(room, name));
    request.setRequestHeader("X-Upload-Key", key);
    request.responseType = "json";
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    request.onerror = () => reject(new Error(`Uploading ${name} failed`));
    request.onload = () => {
      if (request.status === 201) resolve(request.response);
      else reject(new Error(`${name}: ${request.response?.error ?? "the server answered " + request.status}`));
    };
    request.send(file);
  });
}

// Downloads a shared mod as a Blob, kept in the browser's cache by content hash
// so a mod is only downloaded once per browser.
export async function fetchRoomMod(room, mod) {
  const cacheKey = "/mod-cache/" + mod.sha256;
  const cache = await caches.open("zero-hour-mods").catch(() => null);
  let response = await cache?.match(cacheKey);
  if (!response) {
    response = await fetch(address(room, mod.name), { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not download ${mod.name}`);
    if (cache) {
      await cache.put(cacheKey, response.clone()).catch(() => {});
    }
  }
  const blob = await response.blob();
  if (blob.size !== mod.size) {
    await cache?.delete(cacheKey);
    throw new Error(`${mod.name} did not download completely. Try again.`);
  }
  return blob;
}
