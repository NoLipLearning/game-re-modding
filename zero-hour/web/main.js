import { FileBridge } from "./filebridge.js";
import { listRoomMods, shareMod, removeRoomMod, fetchRoomMod } from "./roommods.js";

const $ = (id) => document.getElementById(id);
const chosen = { zh: [], gen: [], mods: [] };

// --- what this browser can do -------------------------------------------------
const problems = [];
if (!navigator.gpu) problems.push("This browser has no WebGPU. Use a current Chrome or Edge.");
if (!globalThis.crossOriginIsolated) {
  problems.push("The page is not cross-origin isolated. Serve it with the bundled server over HTTPS or on localhost.");
}
if (problems.length) {
  $("unsupported").textContent = problems.join(" ");
  $("unsupported").hidden = false;
}

// --- choosing files -----------------------------------------------------------
// Returns [{ path: "relative/path", file: File }] for a folder the player picks.
function pickFolder() {
  return new Promise((resolve) => {
    const input = $("dir-input");
    input.value = "";
    input.onchange = () => resolve([...input.files].map((file) => ({
      // webkitRelativePath starts with the picked folder's own name; drop it.
      path: file.webkitRelativePath.split("/").slice(1).join("/"),
      file,
    })));
    input.click();
  });
}

function describe(entries) {
  const archives = entries.filter((entry) => /\.big$/i.test(entry.path)).length;
  if (!entries.length) return "Not chosen";
  return archives ? `${archives} archives, ${entries.length} files` : "No .big archives found in that folder";
}

function refresh() {
  $("zh-status").textContent = describe(chosen.zh);
  $("gen-status").textContent = describe(chosen.gen);
  $("mods-status").textContent = chosen.mods.length ? chosen.mods.map((mod) => mod.path).join(", ") : "None";
  const hasArchives = (entries) => entries.some((entry) => /\.big$/i.test(entry.path));
  $("share-mods").disabled = !chosen.mods.length;
  $("play").disabled = problems.length > 0 || !hasArchives(chosen.zh) || !hasArchives(chosen.gen);
}

$("pick-zh").onclick = async () => { chosen.zh = await pickFolder(); refresh(); };
$("pick-gen").onclick = async () => { chosen.gen = await pickFolder(); refresh(); };
$("pick-mods").onclick = () => {
  const input = $("mod-input");
  input.value = "";
  input.onchange = () => { chosen.mods = [...input.files].map((file) => ({ path: file.name, file })); refresh(); };
  input.click();
};

// --- multiplayer room ---------------------------------------------------------
const cleanRoom = (value) => value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32);
$("room").value = cleanRoom(new URLSearchParams(location.search).get("room") ?? "");
$("copy-link").onclick = async () => {
  const room = cleanRoom($("room").value);
  if (!room) { $("room").focus(); return; }
  const link = new URL(location.href);
  link.search = "?room=" + room;
  await navigator.clipboard.writeText(link.href);
  $("copy-link").textContent = "Copied";
  setTimeout(() => { $("copy-link").textContent = "Copy invite link"; }, 1500);
};

// --- mods shared with the room ------------------------------------------------
const megabytes = (bytes) => (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) + " MB";
let roomMods = [];

function showRoomMods(room, mods) {
  roomMods = mods;
  $("room-mods-name").textContent = room;
  const list = $("room-mods-list");
  list.replaceChildren(...mods.map((mod) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${mod.name} (${megabytes(mod.size)})`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.onclick = () => changeRoomMods(room, () => removeRoomMod(room, mod.name, $("upload-key").value));
    item.append(label, remove);
    return item;
  }));
  if (!mods.length) {
    const none = document.createElement("li");
    none.className = "status";
    none.textContent = "Nothing shared yet";
    list.append(none);
  }
}

async function loadRoomMods() {
  const room = cleanRoom($("room").value);
  $("room-mods").hidden = !room;
  if (!room) { roomMods = []; return; }
  try {
    showRoomMods(room, await listRoomMods(room));
  } catch (error) {
    showRoomMods(room, []);
    $("share-status").textContent = "Could not read the room's mods: " + error.message;
  }
}

async function changeRoomMods(room, change) {
  const status = $("share-status");
  status.classList.remove("error");
  try {
    showRoomMods(room, await change((text) => { status.textContent = text; }));
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  }
}

$("room").addEventListener("change", loadRoomMods);
$("share-mods").onclick = () => {
  const room = cleanRoom($("room").value);
  return changeRoomMods(room, async (say) => {
    let mods = roomMods;
    for (const { path, file } of chosen.mods) {
      mods = await shareMod(room, path, file, $("upload-key").value,
        (done) => say(`Uploading ${path}: ${Math.round(done * 100)}%`));
    }
    return mods;
  });
};
loadRoomMods();

// --- when the game stops ------------------------------------------------------
const gameLog = []; // the engine's most recent output
function record(line, show) {
  gameLog.push(line);
  if (gameLog.length > 400) gameLog.shift();
  show(line);
}
let ended = false;
function gameEnded(reason) {
  if (ended) return;
  ended = true;
  $("canvas").hidden = true;
  $("show-log").hidden = true;
  $("setup").hidden = true;
  $("ended-reason").textContent = reason;
  $("ended-log").value = gameLog.join("\n");
  $("ended").hidden = false;
  $("ended-log").scrollTop = $("ended-log").scrollHeight;
}
$("copy-log").onclick = async () => {
  await navigator.clipboard.writeText($("ended-log").value);
  $("copy-log").textContent = "Copied";
  setTimeout(() => { $("copy-log").textContent = "Copy log"; }, 1500);
};
$("reload").onclick = () => location.reload();
// For when the game hangs or shows a black screen without stopping by itself.
$("show-log").onclick = () => gameEnded("You stopped the game to look at its log.");

// --- starting the game --------------------------------------------------------
$("play").onclick = async () => {
  const progress = $("progress");
  $("play").disabled = true;
  try {
    const room = cleanRoom($("room").value) || "lobby";
    const scheme = location.protocol === "https:" ? "wss://" : "ws://";
    // The engine reads this when it opens its network sockets.
    globalThis.generalsXLanRelayUrl = `${scheme}${location.host}/GeneralsXLan?room=${room}`;

    // Mods shared with the room, unless the player picked a file of the same name.
    const mine = new Set(chosen.mods.map((mod) => mod.path.toLowerCase()));
    const shared = [];
    for (const mod of room === "lobby" ? [] : await listRoomMods(room)) {
      if (mine.has(mod.name.toLowerCase())) continue;
      progress.textContent = `Getting mod ${mod.name}…`;
      shared.push({ path: mod.name, file: await fetchRoomMod(room, mod) });
    }

    progress.textContent = "Loading the engine…";
    const { default: createGeneralsX } = await import("./GeneralsXZH.js");
    const font = new Uint8Array(await (await fetch("fonts/LiberationSans-Regular.ttf")).arrayBuffer());
    const canvas = $("canvas");
    const bridge = new FileBridge();
    await bridge.ready;

    await createGeneralsX({
      canvas,
      noInitialRun: true,
      print: (line) => record(line, console.log),
      printErr: (line) => record(line, console.warn),
      onExit: (code) => gameEnded(code === 0 ? "The game was closed." : `The game stopped with exit code ${code}.`),
      onAbort: (what) => gameEnded("The game crashed: " + what),
      quit: (code) => gameEnded(code === 0 ? "The game was closed." : `The game stopped with exit code ${code}.`),
      preRun: [(module) => {
        const { FS } = module;
        for (const { path, file } of chosen.gen) bridge.mount(FS, "/Generals/" + path, file);
        for (const { path, file } of chosen.zh) bridge.mount(FS, "/GeneralsZH/" + path, file);
        // Mods go in the Zero Hour folder, where the engine scans for archives.
        for (const { path, file } of [...shared, ...chosen.mods]) bridge.mount(FS, "/GeneralsZH/" + path, file);
        FS.mkdirTree("/fonts");
        FS.writeFile("/fonts/GeneralsX.ttf", font);
        // Settings and saves persist in this browser between visits.
        FS.mkdirTree("/home/web_user");
        FS.mount(module.IDBFS, {}, "/home/web_user");
        module.addRunDependency("saved-data");
        FS.syncfs(true, () => module.removeRunDependency("saved-data"));
        setInterval(() => FS.syncfs(false, () => {}), 30000);
        addEventListener("pagehide", () => FS.syncfs(false, () => {}));
      }],
      onRuntimeInitialized() {
        $("setup").hidden = true;
        canvas.hidden = false;
        $("show-log").hidden = false;
        canvas.focus();
        // The engine runs in pieces between frames, so a crash can surface as a page error.
        const crashed = (event) => {
          const error = event.reason ?? event.error ?? event.message;
          record(String(error?.stack ?? error), console.error);
          gameEnded("The game crashed: " + (error?.message ?? error));
        };
        addEventListener("unhandledrejection", crashed);
        addEventListener("error", crashed);
        globalThis.generalsX = this; // for the browser console when something goes wrong
        this.FS.chdir("/GeneralsZH");
        try {
          this.callMain([]);
        } catch (error) {
          record(String(error?.stack ?? error), console.error);
          gameEnded("The game crashed: " + (error?.message ?? error));
        }
      },
    });
  } catch (error) {
    console.error(error);
    progress.textContent = "Could not start: " + (error?.message ?? error);
    progress.classList.add("error");
    $("play").disabled = false;
  }
};

refresh();
