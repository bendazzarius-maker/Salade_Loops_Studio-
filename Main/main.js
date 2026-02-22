const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { spawn } = require("child_process");
const os = require("os");

let mainWindow = null;

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

    audioPending.set(id, { resolve, timer, op: message.op });
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

function hashString(value = "") {
  let h = 2166136261;
  const str = String(value || "");
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function startAudioEngine() {
  const bin = resolveAudioEnginePath();

  if (!fsSync.existsSync(bin)) {
    console.warn("[JUCE] Engine binary not found:", bin);
    console.warn(
      "[JUCE] Put it in ./native (dev) or in resources/native (packaged)."
    );
    return;
  }

  audioProc = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });

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
          const pending = audioPending.get(String(msg.id));
          clearTimeout(pending.timer);
          audioPending.delete(String(msg.id));
          pending.resolve(msg);
          continue;
        }
        if (mainWindow && !mainWindow.isDestroyed() && msg?.type === "evt") {
          mainWindow.webContents.send("audio:native:event", msg);
        }
      } catch {
        console.warn("[JUCE] stdout non-JSON:", line);
      }
    }
  });

  audioProc.stderr.on("data", (d) =>
    console.warn("[JUCE][stderr]", d.toString("utf8"))
  );

  audioProc.on("exit", (code) => {
    console.warn("[JUCE] engine exited with code:", code);
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
  return requestAudio(message, 2000);
});

ipcMain.handle("audio:native:isAvailable", async () => {
  return { ok: !!audioProc };
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
  }

  const relativeFilePath = path.relative(root, outFile).replace(/\\/g, "/");

  const toWrite = {
    ...program,
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
