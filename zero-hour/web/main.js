import { FileBridge } from "./filebridge.js";

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

// --- starting the game --------------------------------------------------------
$("play").onclick = async () => {
  const progress = $("progress");
  $("play").disabled = true;
  try {
    const room = cleanRoom($("room").value) || "lobby";
    const scheme = location.protocol === "https:" ? "wss://" : "ws://";
    // The engine reads this when it opens its network sockets.
    globalThis.generalsXLanRelayUrl = `${scheme}${location.host}/GeneralsXLan?room=${room}`;

    progress.textContent = "Loading the engine…";
    const { default: createGeneralsX } = await import("./GeneralsXZH.js");
    const font = new Uint8Array(await (await fetch("fonts/LiberationSans-Regular.ttf")).arrayBuffer());
    const canvas = $("canvas");

    await createGeneralsX({
      canvas,
      noInitialRun: true,
      print: (line) => console.log(line),
      printErr: (line) => console.warn(line),
      preRun: [(module) => {
        const { FS } = module;
        const bridge = new FileBridge();
        for (const { path, file } of chosen.gen) bridge.mount(FS, "/Generals/" + path, file);
        for (const { path, file } of chosen.zh) bridge.mount(FS, "/GeneralsZH/" + path, file);
        // Mods go in the Zero Hour folder, where the engine scans for archives.
        for (const { path, file } of chosen.mods) bridge.mount(FS, "/GeneralsZH/" + path, file);
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
        canvas.focus();
        this.FS.chdir("/GeneralsZH");
        this.callMain([]);
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
