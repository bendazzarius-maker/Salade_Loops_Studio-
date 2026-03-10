const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { spawn } = require("child_process");
const os = require("os");

let mainWindow = null;
let drumWindow = null;

// -----------------------------------------------------------------------------
// SINGLE INSTANCE LOCK
// -----------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}


function sendToMainWindow(channel, payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  } catch (_) {}
}

function ensureDrumWindow(bounds = {}) {
  if (drumWindow && !drumWindow.isDestroyed()) {
    if (drumWindow.isMinimized()) drumWindow.restore();
    drumWindow.show();
    drumWindow.focus();
    return drumWindow;
  }

  drumWindow = new BrowserWindow({
    width: Math.max(900, Number(bounds.width) || 1180),
    height: Math.max(620, Number(bounds.height) || 800),
    x: Number.isFinite(Number(bounds.x)) ? Number(bounds.x) : undefined,
    y: Number.isFinite(Number(bounds.y)) ? Number(bounds.y) : undefined,
    title: 'Drum Machine FM',
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  drumWindow.loadFile(path.join(__dirname, 'drum_machine_fm.html'), { query: { detached: '1' } });
  drumWindow.on('closed', () => {
    drumWindow = null;
    sendToMainWindow('drum-window:closed', {});
  });
  return drumWindow;
}
// -----------------------------------------------------------------------------
// JUCE AUDIO ENGINE HOST (spawn in MAIN process)
// -----------------------------------------------------------------------------
let audioProc = null;
const audioPending = new Map();
let audioEventSeq = 0;

function nowMs() {
  return Date.now();
}

function buildEngineRequest(op, data = {}, id = `main-${nowMs()}-${Math.random().toString(36).slice(2, 8)}`) {
  return {
    v: 1,
    type: "req",
    op,
    id,
    ts: nowMs(),
    data: data || {},
  };
}

function resolveAudioEnginePath() {
  // DEV: binaire copié dans ./native
  const devBin =
    process.platform === "win32"
      ? path.join(__dirname, "native", "sls-audio-engine.exe")
      : path.join(__dirname, "native", "sls-audio-engine");

  if (fsSync.existsSync(devBin)) return devBin;

  // PACKAGED: resources/native (extraResources)
  const resBase = process.resourcesPath || __dirname;
  const pkgBin =
    process.platform === "win32"
      ? path.join(resBase, "native", "sls-audio-engine.exe")
      : path.join(resBase, "native", "sls-audio-engine");

  return pkgBin;
}


function resolveVstHostPath() {
  const devBin =
    process.platform === "win32"
      ? path.join(__dirname, "native", "sls-vst-host.exe")
      : path.join(__dirname, "native", "sls-vst-host");

  if (fsSync.existsSync(devBin)) return devBin;

  const resBase = process.resourcesPath || __dirname;
  return process.platform === "win32"
    ? path.join(resBase, "native", "sls-vst-host.exe")
    : path.join(resBase, "native", "sls-vst-host");
}

let vstHostProc = null;
let vstHostBuffer = "";
const vstHostPending = new Map();

function extractJsonObjectsFromBuffer(input) {
  const objects = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(input.slice(start, i + 1));
        start = -1;
      }
    }
  }

  if (depth > 0 && start >= 0) {
    return { objects, rest: input.slice(start) };
  }

  return { objects, rest: "" };
}

function stopVstHostProcess() {
  if (!vstHostProc) return;
  try { vstHostProc.kill(); } catch (_) {}
  vstHostProc = null;
  vstHostBuffer = "";
  for (const [id, pending] of vstHostPending.entries()) {
    clearTimeout(pending.timer);
    pending.resolve({
      v: 1,
      type: "res",
      op: pending.op,
      id,
      ts: nowMs(),
      ok: false,
      err: { code: "E_HOST_EXIT", message: "vst-host process exited", details: {} },
    });
  }
  vstHostPending.clear();
}

function ensureVstHostProcess() {
  if (vstHostProc && !vstHostProc.killed) return vstHostProc;
  const bin = resolveVstHostPath();
  if (!fsSync.existsSync(bin)) return null;

  vstHostProc = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
  vstHostBuffer = "";

  vstHostProc.on("error", () => {
    stopVstHostProcess();
  });

  vstHostProc.on("exit", () => {
    stopVstHostProcess();
  });

  vstHostProc.stderr.on("data", (d) => {
    console.warn("[VST-HOST][stderr]", d.toString("utf8"));
  });

  vstHostProc.stdout.on("data", (d) => {
    vstHostBuffer += d.toString("utf8");
    const { objects, rest } = extractJsonObjectsFromBuffer(vstHostBuffer);
    vstHostBuffer = rest;

    for (const chunk of objects) {
      let msg = null;
      try {
        msg = JSON.parse(chunk);
      } catch (err) {
        console.warn("[VST-HOST] bad json:", err?.message || err, chunk);
        continue;
      }

      const id = String(msg?.id || "");
      const pending = vstHostPending.get(id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      vstHostPending.delete(id);
      pending.resolve(msg);
    }
  });

  return vstHostProc;
}

async function requestVstHost(op, data = {}, timeoutMs = 20000) {
  const bin = resolveVstHostPath();
  if (!fsSync.existsSync(bin)) {
    return {
      v: 1,
      type: "res",
      op,
      id: `vst-host-${nowMs()}`,
      ts: nowMs(),
      ok: false,
      err: { code: "E_NOT_READY", message: `VST host binary not found: ${bin}`, details: {} },
    };
  }

  const child = ensureVstHostProcess();
  if (!child?.stdin) {
    return {
      v: 1,
      type: "res",
      op,
      id: `vst-host-${nowMs()}`,
      ts: nowMs(),
      ok: false,
      err: { code: "E_NOT_READY", message: "vst-host process unavailable", details: {} },
    };
  }

  const req = buildEngineRequest(op, data, `vst-host-${nowMs()}-${Math.random().toString(36).slice(2, 8)}`);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      vstHostPending.delete(req.id);
      resolve({
        v: 1,
        type: "res",
        op,
        id: req.id,
        ts: nowMs(),
        ok: false,
        err: { code: "E_TIMEOUT", message: "vst-host request timed out", details: {} },
      });
    }, Math.max(1000, Number(timeoutMs) || 20000));

    vstHostPending.set(req.id, { resolve, timer, op });

    try {
      child.stdin.write(JSON.stringify(req) + "\n");
    } catch (err) {
      clearTimeout(timer);
      vstHostPending.delete(req.id);
      resolve({
        v: 1,
        type: "res",
        op,
        id: req.id,
        ts: nowMs(),
        ok: false,
        err: { code: "E_STDIN", message: err?.message || String(err), details: {} },
      });
    }
  });
}

function sendRawToAudio(message) {
  if (!audioProc?.stdin) return false;
  try {
    audioProc.stdin.write(JSON.stringify(message) + "\n");
    return true;
  } catch (e) {
    console.warn("[JUCE] send failed:", e);
    return false;
  }
}

function failAllPending(code, message) {
  for (const [id, pending] of audioPending.entries()) {
    clearTimeout(pending.timer);
    pending.resolve({
      v: 1,
      type: "res",
      op: pending.op,
      id,
      ts: nowMs(),
      ok: false,
      err: { code, message, details: {} },
    });
  }
  audioPending.clear();
}

async function requestAudio(message, timeoutMs = 1200) {
  if (!audioProc) {
    return {
      v: 1,
      type: "res",
      op: message?.op || "unknown",
      id: message?.id || "0",
      ts: nowMs(),
      ok: false,
      err: { code: "E_NOT_READY", message: "Audio engine not running.", details: {} },
    };
  }

  return new Promise((resolve) => {
    const id = String(message.id || `main-${nowMs()}`);
    const timer = setTimeout(() => {
      audioPending.delete(id);
      resolve({
        v: 1,
        type: "res",
        op: message.op,
        id,
        ts: nowMs(),
        ok: false,
        err: { code: "E_TIMEOUT", message: "Audio engine request timed out.", details: {} },
      });
    }, timeoutMs);

    audioPending.set(id, { resolve, timer, op: message.op, data: message.data || {}, sentAt: Date.now() });
    const sent = sendRawToAudio({ ...message, id });
    if (!sent) {
      clearTimeout(timer);
      audioPending.delete(id);
      resolve({
        v: 1,
        type: "res",
        op: message.op,
        id,
        ts: nowMs(),
        ok: false,
        err: { code: "E_NOT_READY", message: "Audio engine stdin unavailable.", details: {} },
      });
    }
  });
}

function hashString(value = "") {
  let h = 2166136261;
  const str = String(value || "");
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function shouldEmitIpcPong(op) {
  const k = String(op || "");
  return (
    k === "mixer.param.set" ||
    k === "mixer.master.set" ||
    k === "mixer.channel.set" ||
    k === "fx.param.set" ||
    k === "fx.chain.set" ||
    k === "fx.bypass.set" ||
    k === "inst.param.set"
  );
}

let _lastAudioEvtSentAt = 0;
function safeSendAudioEvent(channel, payload, opts = {}) {
  const highPriority = !!opts.highPriority;
  const now = Date.now();
  if (!highPriority) {
    if (now - _lastAudioEvtSentAt < 8) return;
    _lastAudioEvtSentAt = now;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (!wc || wc.isDestroyed() || wc.isCrashed()) return;
  try {
    wc.send(channel, payload);
  } catch (err) {
    console.warn("[JUCE] safeSendAudioEvent failed", err?.message || err);
  }
}

function startAudioEngine() {
  const bin = resolveAudioEnginePath();

  if (!fsSync.existsSync(bin)) {
    console.warn("[JUCE] Engine binary not found:", bin);
    console.warn("[JUCE] Put it in ./native (dev) or in resources/native (packaged).");
    return;
  }

  // Linux: ensure executable bit
  if (process.platform !== "win32") {
    try {
      const st = fsSync.statSync(bin);
      // if no execute bits, add u+x
      if ((st.mode & 0o111) === 0) {
        fsSync.chmodSync(bin, st.mode | 0o755);
        console.log("[JUCE] chmod +x applied:", bin);
      }
    } catch (e) {
      console.warn("[JUCE] chmod/stat failed:", e?.message || e);
    }
  }

  try {
    audioProc = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    console.warn("[JUCE] spawn failed:", e?.message || e);
    audioProc = null;
    return;
  }

  console.log("[JUCE] spawned:", bin, "pid=", audioProc?.pid);

  let buf = "";

  audioProc.stdout.on("data", (d) => {
    buf += d.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;

      try {
        const msg = JSON.parse(line);
        if (msg?.type === "res" && msg.id && audioPending.has(String(msg.id))) {
          const pendingId = String(msg.id);
          const pending = audioPending.get(pendingId);
          clearTimeout(pending.timer);
          audioPending.delete(pendingId);
          pending.resolve(msg);

          const pongOp = pending?.op || msg?.op || "unknown";
          if (shouldEmitIpcPong(pongOp)) {
            const pongEvt = {
              v: 1,
              type: "evt",
              op: "ipc.pong",
              ts: Date.now(),
              data: {
                id: pendingId,
                op: pongOp,
                ok: !!msg?.ok,
                sentAt: Number(pending?.sentAt || 0),
                ackAt: Date.now(),
                rttMs: Math.max(0, Date.now() - Number(pending?.sentAt || Date.now())),
                requestData: pending?.data || {},
                err: msg?.err || null
              }
            };
            safeSendAudioEvent("audio:native:event", pongEvt, { highPriority: true });
          }
          continue;
        }
        if (mainWindow && !mainWindow.isDestroyed() && msg?.type === "evt") {
          safeSendAudioEvent("audio:native:event", msg);
        }
      } catch {
        console.warn("[JUCE] stdout non-JSON:", line);
      }
    }
  });

  audioProc.stderr.on("data", (d) => console.warn("[JUCE][stderr]", d.toString("utf8")));

  audioProc.on("error", (err) => {
    console.warn("[JUCE] process error:", err?.message || err);
    failAllPending("E_NOT_READY", "Audio engine process error.");
    audioProc = null;
  });

  audioProc.on("exit", (code, signal) => {
    console.warn("[JUCE] engine exited with:", { code, signal });
    failAllPending("E_NOT_READY", "Audio engine exited.");
    audioProc = null;
  });
}

function stopAudioEngine() {
  if (!audioProc) return;
  try {
    sendRawToAudio(buildEngineRequest("engine.shutdown", {}, "main-shutdown"));
  } catch (_) {}
  try {
    audioProc.kill();
  } catch (_) {}
  audioProc = null;
}

// Renderer -> Engine
ipcMain.handle("audio:native:req", async (_evt, message) => {
  if (!message || message.v !== 1 || message.type !== "req" || typeof message.op !== "string") {
    return {
      v: 1,
      type: "res",
      op: message?.op || "unknown",
      id: message?.id || "0",
      ts: nowMs(),
      ok: false,
      err: { code: "E_BAD_ENVELOPE", message: "Invalid SLS-IPC request envelope.", details: {} },
    };
  }
  return requestAudio(message, 5000);
});

ipcMain.handle("audio:native:isAvailable", async () => {
  return { ok: !!audioProc };
});

ipcMain.handle("drumkit:emit", async (_evt, payload = {}) => {
  const type = String(payload?.type || "").trim();
  if (!type) return { ok: false, err: "Missing drumkit event type" };
  return { ok: true, data: { type, payload: payload?.payload ?? null } };
});

ipcMain.handle("drumkit:loadKit", async (_evt, payload = {}) => {
  const kitId = String(payload?.kitId || "").trim();
  if (!kitId) return { ok: false, err: "Missing kitId" };
  const safeKitId = kitId.replace(/[^a-zA-Z0-9_-]/g, "");
  const filePath = path.join(__dirname, "drum_kits", `${safeKitId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return { ok: true, data: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, err: `Unable to load drum kit '${safeKitId}'`, details: String(error?.message || error) };
  }
});


ipcMain.handle("drum-window:open", async (_evt, payload = {}) => {
  const win = ensureDrumWindow(payload?.bounds || {});
  const snapshot = payload?.snapshot ?? null;
  win.webContents.once('did-finish-load', () => {
    try {
      win.webContents.send('drum-window:host-message', {
        source: 'sls-drumkit-host',
        type: 'drumkit:set-state',
        payload: snapshot || {},
      });
    } catch (_) {}
  });
  if (snapshot && !win.webContents.isLoading()) {
    try {
      win.webContents.send('drum-window:host-message', {
        source: 'sls-drumkit-host',
        type: 'drumkit:set-state',
        payload: snapshot,
      });
    } catch (_) {}
  }
  return { ok: true };
});

ipcMain.handle("drum-window:host-message", async (_evt, payload = {}) => {
  if (!drumWindow || drumWindow.isDestroyed()) return { ok: false, err: 'drum window not open' };
  try {
    drumWindow.webContents.send('drum-window:host-message', payload);
    return { ok: true };
  } catch (error) {
    return { ok: false, err: String(error?.message || error) };
  }
});

ipcMain.handle("drum-window:ui-message", async (_evt, payload = {}) => {
  sendToMainWindow('drum-window:ui-message', payload);
  return { ok: true };
});

ipcMain.handle("drum-window:close", async () => {
  try { if (drumWindow && !drumWindow.isDestroyed()) drumWindow.close(); } catch (_) {}
  return { ok: true };
});
// -----------------------------------------------------------------------------
// WINDOW
// -----------------------------------------------------------------------------
function createWindow() {
  const iconPath = path.join(__dirname, "build", "icons", "512x512.png");

  mainWindow = new BrowserWindow({
    fullscreen: true,
    backgroundColor: "#0b1020",
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // mainWindow.webContents.openDevTools({ mode: "detach" });
}

app.setName("Salad Loops Studio");

app.whenReady().then(() => {
  readSamplerConfig().catch(() => {});
  createWindow();
  startAudioEngine();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  stopAudioEngine();
  stopVstHostProcess();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// -----------------------------------------------------------------------------
// SAVE / LOAD PROJECT
// -----------------------------------------------------------------------------
ipcMain.handle("project:save", async (_evt, payload) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Sauvegarder le projet Salad Loops Studio",
    defaultPath: "Projet.sls.json",
    filters: [{ name: "Salad Loops Project", extensions: ["json"] }],
  });

  if (canceled || !filePath) return { ok: false, canceled: true };

  const data = JSON.stringify(payload, null, 2);
  await fs.writeFile(filePath, data, "utf-8");
  return { ok: true, path: filePath };
});

ipcMain.handle("project:load", async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;

  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Charger un projet Salad Loops Studio",
    properties: ["openFile"],
    filters: [{ name: "Salad Loops Project", extensions: ["json"] }],
  });

  if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };

  const raw = await fs.readFile(filePaths[0], "utf-8");
  const parsed = JSON.parse(raw);
  return { ok: true, path: filePaths[0], data: parsed };
});

// -----------------------------------------------------------------------------
// SAMPLER LIBRARY
// -----------------------------------------------------------------------------
const SUPPORTED_SAMPLE_EXTENSIONS = new Set([".wav", ".mp3", ".ogg"]);
const PROGRAM_FILE_EXT = ".slsprog.json";
const SAMPLE_PATTERN_PROGRAM_EXT = ".spp.json";

const SAMPLER_CONFIG_FILE = path.join(app.getPath("userData"), "sampler-programs-config.json");
let samplerProgramsRootOverride = null;

async function readSamplerConfig() {
  try {
    const raw = await fs.readFile(SAMPLER_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.programsRootPath === "string" && parsed.programsRootPath.trim()) {
      samplerProgramsRootOverride = parsed.programsRootPath.trim();
    }
  } catch (_error) {
    samplerProgramsRootOverride = null;
  }
}

async function writeSamplerConfig() {
  const payload = { programsRootPath: samplerProgramsRootOverride || "" };
  await fs.mkdir(path.dirname(SAMPLER_CONFIG_FILE), { recursive: true });
  await fs.writeFile(SAMPLER_CONFIG_FILE, JSON.stringify(payload, null, 2), "utf-8");
}

function samplerProgramsRoot() {
  if (samplerProgramsRootOverride) return samplerProgramsRootOverride;
  return path.join(app.getPath("documents"), "SL-Studio", "samplerTouski");
}

function getSLStudioRoot() {
  return path.join(app.getPath("documents"), "SL-Studio");
}

function samplePatternRoot() {
  return path.join(getSLStudioRoot(), "samplePattern");
}

function samplePatternProgramsDir() {
  return path.join(samplePatternRoot(), "programs");
}

function samplePatternSamplesDir() {
  return path.join(samplePatternRoot(), "samples");
}

function samplePatternIndexPath() {
  return path.join(samplePatternRoot(), "index.json");
}

async function ensureSamplePatternDirs() {
  await fs.mkdir(samplePatternProgramsDir(), { recursive: true });
  await fs.mkdir(samplePatternSamplesDir(), { recursive: true });
}

function sanitizeProgramName(rawName = "") {
  return String(rawName || "Sample Pattern Program")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "Sample Pattern Program";
}

async function readSamplePatternIndex() {
  try {
    const raw = await fs.readFile(samplePatternIndexPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.programs) ? parsed.programs : [];
  } catch (_) {
    return [];
  }
}

async function writeSamplePatternIndex(programs) {
  const payload = {
    version: 1,
    updatedAt: Date.now(),
    programs: Array.isArray(programs) ? programs : [],
  };
  await fs.writeFile(samplePatternIndexPath(), JSON.stringify(payload, null, 2), "utf-8");
}

async function scanSamplerDirectory(rootDir) {
  const files = [];

  async function walk(currentDir) {
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      console.warn("[Sampler] cannot read directory:", currentDir, err?.message || err);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_SAMPLE_EXTENSIONS.has(ext)) continue;

      files.push({
        name: entry.name,
        ext,
        path: fullPath,
        relativePath: path.relative(rootDir, fullPath),
      });
    }
  }

  await walk(rootDir);
  return files;
}


async function scanVstDirectory(rootDir) {
  const files = [];
  const SUPPORTED_VST_EXTENSIONS = new Set([".vst3", ".dll", ".so", ".component"]);

  function classifyVstPlugin(fileName = "") {
    const n = String(fileName || "").toLowerCase();
    const instrumentHints = ["synth", "piano", "keys", "instrument", "bass", "drum", "sampler", "organ", "lead", "pad"];
    const fxHints = ["reverb", "delay", "chorus", "flanger", "compress", "eq", "limiter", "dist", "satur", "fx", "gate", "phaser"];
    if (instrumentHints.some((x) => n.includes(x))) return "instrument";
    if (fxHints.some((x) => n.includes(x))) return "fx";
    return "unknown";
  }

  async function walk(currentDir) {
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      console.warn("[VST] cannot read directory:", currentDir, err?.message || err);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const ext = path.extname(entry.name).toLowerCase();

      // On macOS, VST3/AU plugins are often bundle directories (.vst3/.component)
      // and would be missed by a file-only scanner.
      if (entry.isDirectory() && SUPPORTED_VST_EXTENSIONS.has(ext)) {
        files.push({
          name: entry.name,
          ext,
          path: fullPath,
          relativePath: path.relative(rootDir, fullPath),
          category: classifyVstPlugin(entry.name),
        });
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SUPPORTED_VST_EXTENSIONS.has(ext)) continue;

      files.push({
        name: entry.name,
        ext,
        path: fullPath,
        relativePath: path.relative(rootDir, fullPath),
        category: classifyVstPlugin(entry.name),
      });
    }
  }

  await walk(rootDir);
  return files;
}

function getDefaultVstScanDirectories() {
  const defaults = [];

  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const common = process.env.CommonProgramFiles || path.join(pf, "Common Files");
    defaults.push(
      path.join(common, "VST3"),
      path.join(pf, "VstPlugins"),
      path.join(pf86, "VstPlugins")
    );
  } else if (process.platform === "darwin") {
    defaults.push(
      "/Library/Audio/Plug-Ins/VST3",
      "/Library/Audio/Plug-Ins/Components",
      path.join(os.homedir(), "Library/Audio/Plug-Ins/VST3"),
      path.join(os.homedir(), "Library/Audio/Plug-Ins/Components")
    );
  } else {
    defaults.push(
      "/usr/lib/vst3",
      "/usr/local/lib/vst3",
      "/usr/lib/vst",
      "/usr/local/lib/vst",
      path.join(os.homedir(), ".vst3"),
      path.join(os.homedir(), ".vst")
    );
  }

  return [...new Set(defaults.filter((p) => p && fsSync.existsSync(p)))];
}

ipcMain.handle("vst:pickDirectories", async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Sélectionner un ou plusieurs dossiers VST",
    properties: ["openDirectory", "multiSelections"],
  });
  if (canceled) return { ok: false, canceled: true };
  return { ok: true, directories: filePaths || [] };
});

ipcMain.handle("vst:scanDirectories", async (_evt, payload = {}) => {
  const requested = Array.isArray(payload.directories) ? payload.directories : [];
  const cleanedRequested = requested.filter((p) => typeof p === "string" && p.trim()).map((p) => p.trim());
  const usedDefaultDirectories = cleanedRequested.length === 0;
  const resolvedDirectories = usedDefaultDirectories ? getDefaultVstScanDirectories() : cleanedRequested;
  const directories = [...new Set(resolvedDirectories.filter((p) => p && fsSync.existsSync(p)))];

  if (directories.length === 0) {
    return {
      ok: false,
      err: {
        code: "E_NO_DIRECTORIES",
        message: "No existing VST directories available to scan",
        details: {
          requested: cleanedRequested,
          defaults: getDefaultVstScanDirectories(),
          platform: process.platform,
        },
      },
      source: "sls-vst-host",
      usedDefaultDirectories,
      scannedDirectories: [],
    };
  }

  const hostRes = await requestVstHost("vst.scan", { directories }, 45000);
  if (hostRes?.ok) {
    const roots = Array.isArray(hostRes?.data?.roots) ? hostRes.data.roots : [];
    return {
      ok: true,
      roots,
      source: "sls-vst-host",
      usedDefaultDirectories,
      scannedDirectories: directories,
    };
  }

  // Backend host unavailable/error: fallback to local extension scan so the
  // VST Manager remains usable (with heuristic classification) instead of dead.
  const indexed = [];
  for (const dirPath of directories) {
    try {
      const files = await scanVstDirectory(dirPath);
      indexed.push({
        rootPath: dirPath,
        rootName: path.basename(dirPath),
        files,
      });
    } catch (err) {
      indexed.push({
        rootPath: dirPath,
        rootName: path.basename(dirPath),
        files: [],
        error: err?.message || String(err),
      });
    }
  }

  return {
    ok: true,
    roots: indexed,
    source: "js-fallback",
    warning: hostRes?.err || { code: "E_NOT_READY", message: "vst-host unavailable" },
    usedDefaultDirectories,
    scannedDirectories: directories,
  };
});

ipcMain.handle("vst:hostHello", async () => {
  const res = await requestVstHost("vst.host.hello", {}, 5000);
  if (!res?.ok) {
    return {
      ok: false,
      err: res?.err || { code: "E_NOT_READY", message: "vst-host unavailable" },
      data: { bin: resolveVstHostPath() },
    };
  }
  return { ok: true, data: { ...(res.data || {}), bin: resolveVstHostPath() } };
});

ipcMain.handle("vst:hostRequest", async (_evt, payload = {}) => {
  const op = String(payload?.op || "").trim();
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const timeoutMs = Math.max(1000, Math.min(120000, Number(payload?.timeoutMs) || 20000));
  if (!op) return { ok: false, err: { code: "E_BAD_REQUEST", message: "op required" } };
  const res = await requestVstHost(op, data, timeoutMs);
  if (res?.ok) return { ok: true, data: res.data || {} };
  return { ok: false, err: res?.err || { code: "E_UNKNOWN", message: "vst-host request failed" } };
});
ipcMain.handle("sampler:pickDirectories", async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Sélectionner un ou plusieurs dossiers de samples",
    properties: ["openDirectory", "multiSelections"],
  });
  if (canceled) return { ok: false, canceled: true };
  return { ok: true, directories: filePaths || [] };
});

ipcMain.handle("sampler:scanDirectories", async (_evt, payload = {}) => {
  const directories = Array.isArray(payload.directories) ? payload.directories : [];
  const indexed = [];

  for (const dirPath of directories) {
    try {
      const files = await scanSamplerDirectory(dirPath);
      indexed.push({
        rootPath: dirPath,
        rootName: path.basename(dirPath),
        files,
      });
    } catch (err) {
      indexed.push({
        rootPath: dirPath,
        rootName: path.basename(dirPath),
        files: [],
        error: err?.message || String(err),
      });
    }
  }

  return { ok: true, roots: indexed };
});

async function resolveNonCollidingFilePath(basePath) {
  let candidate = basePath;
  let i = 2;
  const ext = path.extname(basePath);
  const dir = path.dirname(basePath);
  const stem = path.basename(basePath, ext);
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${stem}_${i}${ext}`);
      i += 1;
    } catch (_missing) {
      return candidate;
    }
  }
}

function normalizeSamplerProgramShape(program = {}) {
  const posAction = Number.isFinite(+program.posAction) ? +program.posAction : ((Number(program.keyActionPct) || 0) / 100);
  const posLoopStartRaw = Number.isFinite(+program.posLoopStart) ? +program.posLoopStart : ((Number(program.loopStartPct) || 15) / 100);
  const posLoopEndRaw = Number.isFinite(+program.posLoopEnd) ? +program.posLoopEnd : ((Number(program.loopEndPct) || 90) / 100);
  const posReleaseRaw = Number.isFinite(+program.posRelease) ? +program.posRelease : ((Number(program.releasePct) || 100) / 100);
  const posLoopStart = Math.max(posAction + 0.001, posLoopStartRaw);
  const posLoopEnd = Math.max(posLoopStart + 0.001, posLoopEndRaw);
  const posRelease = Math.max(posLoopEnd, posReleaseRaw);
  const keyActionPct = Math.round(Math.max(0, Math.min(1, posAction)) * 100);
  const loopStartPct = Math.round(Math.max(0, Math.min(1, posLoopStart)) * 100);
  const loopEndPct = Math.round(Math.max(0, Math.min(1, posLoopEnd)) * 100);
  const releasePct = Math.round(Math.max(0, Math.min(1, posRelease)) * 100);
  const samplePath = String(program.samplePath || program.sample?.path || "").trim();
  const noteMap = Array.isArray(program.noteMap) ? program.noteMap : (Array.isArray(program.mapping) ? program.mapping : []);
  const samples = Array.isArray(program.samples) ? program.samples : [];
  const zones = Array.isArray(program.zones) ? program.zones : [];
  if (!samples.length && samplePath) {
    samples.push({ note: Number(program.rootMidi ?? 60) || 60, samplePath });
  }
  if (!zones.length && samplePath) {
    zones.push({ rootMidi: Number(program.rootMidi ?? 60) || 60, samplePath, keyActionPct, loopStartPct, loopEndPct, releasePct });
  }

  return {
    ...program,
    version: Number(program.version || 2),
    samplePath,
    posAction,
    posLoopStart,
    posLoopEnd,
    posRelease,
    keyActionPct,
    loopStartPct,
    loopEndPct,
    releasePct,
    sustainPct: loopEndPct,
    noteMap,
    mapping: noteMap,
    samples,
    zones,
    smartPlayback: {
      keyActionPct,
      loopStartPct,
      loopEndPct,
      releasePct,
      mode: "hold_loop_then_release",
      ...(program.smartPlayback && typeof program.smartPlayback === "object" ? program.smartPlayback : {}),
    },
  };
}

async function ensureSamplerProgramsRoot() {
  const root = samplerProgramsRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
}

async function scanProgramsTree(rootDir) {
  const programs = [];

  async function walk(currentDir) {
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(PROGRAM_FILE_EXT)) continue;
      try {
        const raw = await fs.readFile(fullPath, "utf-8");
        const parsed = JSON.parse(raw);
        const relativeFilePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
        programs.push({
          ...parsed,
          // Force a stable unique id derived from file path.
          // This avoids id collisions when a program is saved "as" from another one.
          id: relativeFilePath,
          filePath: fullPath,
          relativeFilePath,
          category: path.dirname(relativeFilePath).replace(/\\/g, "/") || "",
        });
      } catch (error) {
        console.warn("[Sampler] invalid program file", fullPath, error?.message || error);
      }
    }
  }

  await walk(rootDir);
  programs.sort((a, b) => String(a.relativeFilePath).localeCompare(String(b.relativeFilePath)));
  return programs;
}

ipcMain.handle("sampler:listPrograms", async () => {
  const root = await ensureSamplerProgramsRoot();
  const programs = await scanProgramsTree(root);
  return { ok: true, rootPath: root, programs };
});

ipcMain.handle("sampler:getProgramsRoot", async () => {
  const root = await ensureSamplerProgramsRoot();
  return { ok: true, rootPath: root };
});

ipcMain.handle("sampler:setProgramsRoot", async (_evt, payload = {}) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  let target = String(payload.rootPath || "").trim();

  if (!target) {
    const picked = await dialog.showOpenDialog(win, {
      title: "Choisir le dossier maître des programmes Sampler Touski",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: samplerProgramsRoot(),
    });
    if (picked.canceled || !picked.filePaths?.[0]) return { ok: false, canceled: true };
    target = String(picked.filePaths[0] || "").trim();
  }

  const resolved = path.resolve(target || os.homedir());
  await fs.mkdir(resolved, { recursive: true });
  samplerProgramsRootOverride = resolved;
  await writeSamplerConfig();
  return { ok: true, rootPath: resolved };
});

ipcMain.handle("sampler:createCategory", async (_evt, payload = {}) => {
  const root = await ensureSamplerProgramsRoot();
  const rel = String(payload.relativeDir || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const target = path.resolve(root, rel || ".");
  if (!target.startsWith(path.resolve(root))) return { ok: false, error: "Chemin invalide" };
  await fs.mkdir(target, { recursive: true });
  return { ok: true, relativeDir: rel };
});

ipcMain.handle("sampler:saveProgram", async (_evt, payload = {}) => {
  const root = await ensureSamplerProgramsRoot();
  const program = payload.program && typeof payload.program === "object" ? payload.program : null;
  if (!program) return { ok: false, error: "Programme invalide" };

  const mode = payload.mode === "update" ? "update" : "saveAs";
  const relativeDir = String(payload.relativeDir || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const cleanName = String(program.name || "Sampler Program").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  const fileName = `${cleanName || "Sampler Program"}${PROGRAM_FILE_EXT}`;

  let outFile = "";
  if (mode === "update" && payload.targetFilePath) {
    const requested = path.resolve(String(payload.targetFilePath));
    if (requested.startsWith(path.resolve(root))) outFile = requested;
  }
  if (!outFile) {
    const dir = path.resolve(root, relativeDir || ".");
    if (!dir.startsWith(path.resolve(root))) return { ok: false, error: "Dossier invalide" };
    await fs.mkdir(dir, { recursive: true });
    outFile = path.join(dir, fileName);
    if (mode === "saveAs") outFile = await resolveNonCollidingFilePath(outFile);
  }

  const relativeFilePath = path.relative(root, outFile).replace(/\\/g, "/");

  const toWrite = {
    ...normalizeSamplerProgramShape(program),
    id: relativeFilePath,
    updatedAt: new Date().toISOString(),
    category: path.dirname(relativeFilePath).replace(/\\/g, "/") || "",
  };
  await fs.writeFile(outFile, JSON.stringify(toWrite, null, 2), "utf-8");
  return {
    ok: true,
    rootPath: root,
    filePath: outFile,
    relativeFilePath,
    program: toWrite,
  };
});

ipcMain.handle("samplePattern:saveProgram", async (_evt, payload = {}) => {
  await ensureSamplePatternDirs();

  const now = Date.now();
  const cleanName = sanitizeProgramName(payload.name || "SamplePattern");
  const inputSamplePath = String(payload.samplePath || "").trim();
  if (!inputSamplePath) return { ok: false, error: "samplePath requis" };

  let resolvedSamplePath = path.resolve(inputSamplePath);
  const importMode = String(payload.importMode || "reference").toLowerCase();

  if (importMode === "import") {
    const ext = path.extname(resolvedSamplePath) || ".wav";
    const copiedName = `${cleanName}_${hashString(`${resolvedSamplePath}-${now}`)}${ext}`;
    const dst = path.join(samplePatternSamplesDir(), copiedName);
    await fs.copyFile(resolvedSamplePath, dst);
    resolvedSamplePath = dst;
  }

  const program = {
    version: 1,
    name: cleanName,
    createdAt: now,
    updatedAt: now,
    sample: {
      mode: importMode === "import" ? "import" : "reference",
      path: resolvedSamplePath,
      originalPath: inputSamplePath,
      sha1: "",
    },
    slice: {
      startNorm: Math.max(0, Math.min(1, Number(payload.startNorm ?? 0))),
      endNorm: Math.max(0, Math.min(1, Number(payload.endNorm ?? 1))),
    },
    playback: {
      rootMidi: Math.max(0, Math.min(127, Math.floor(Number(payload.rootMidi ?? 60)))),
      pitchMode: String(payload.pitchMode || "chromatic"),
      gain: Math.max(0, Math.min(2, Number(payload.gain ?? 1))),
      pan: Math.max(-1, Math.min(1, Number(payload.pan ?? 0))),
    },
  };
  if (program.slice.endNorm <= program.slice.startNorm) {
    program.slice.endNorm = Math.min(1, program.slice.startNorm + 0.001);
  }

  const programFile = path.join(samplePatternProgramsDir(), `${cleanName}${SAMPLE_PATTERN_PROGRAM_EXT}`);
  await fs.writeFile(programFile, JSON.stringify(program, null, 2), "utf-8");

  const sampleId = `sp_${hashString(resolvedSamplePath.toLowerCase())}`;
  const entry = {
    name: cleanName,
    programPath: programFile,
    updatedAt: now,
    samplePath: resolvedSamplePath,
    sampleId,
  };

  const existing = await readSamplePatternIndex();
  const filtered = existing.filter((it) => String(it.programPath) !== programFile);
  filtered.push(entry);
  filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  await writeSamplePatternIndex(filtered);

  return {
    ok: true,
    programPath: programFile,
    programName: cleanName,
    resolvedSamplePath,
    sampleId,
  };
});

ipcMain.handle("samplePattern:listPrograms", async () => {
  await ensureSamplePatternDirs();
  const programs = await readSamplePatternIndex();
  return { ok: true, rootPath: samplePatternProgramsDir(), programs };
});

ipcMain.handle("samplePattern:loadProgram", async (_evt, payload = {}) => {
  await ensureSamplePatternDirs();
  const programPath = String(payload.programPath || "").trim();
  if (!programPath) return { ok: false, error: "programPath requis" };
  const resolved = path.resolve(programPath);
  const root = path.resolve(samplePatternProgramsDir());
  if (!resolved.startsWith(root)) return { ok: false, error: "Chemin invalide" };
  const raw = await fs.readFile(resolved, "utf-8");
  const program = JSON.parse(raw);
  return { ok: true, programPath: resolved, program };
});
