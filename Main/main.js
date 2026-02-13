const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { spawn } = require("child_process");

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

function sendToAudio(op, data = {}) {
  if (!audioProc?.stdin) return;
  try {
    audioProc.stdin.write(JSON.stringify({ op, data }) + "\n");
  } catch (e) {
    console.warn("[JUCE] send failed:", e);
  }
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
        if (mainWindow && !mainWindow.isDestroyed()) {
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
    audioProc = null;
  });

  // sanity-check
  sendToAudio("ping", {});
}

function stopAudioEngine() {
  if (!audioProc) return;
  try {
    sendToAudio("quit", {});
  } catch (_) {}
  try {
    audioProc.kill();
  } catch (_) {}
  audioProc = null;
}

// Renderer -> Engine
ipcMain.handle("audio:native:send", async (_evt, payload) => {
  if (!payload || typeof payload.op !== "string") return { ok: false };
  sendToAudio(payload.op, payload.data || {});
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

function samplerProgramsRoot() {
  return path.join(app.getPath("documents"), "Sl studio", "sampleTouski");
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
        programs.push({
          ...parsed,
          id: parsed.id || path.relative(rootDir, fullPath).replace(/\\/g, "/"),
          filePath: fullPath,
          relativeFilePath: path.relative(rootDir, fullPath).replace(/\\/g, "/"),
          category: path.dirname(path.relative(rootDir, fullPath)).replace(/\\/g, "/") || "",
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

  const toWrite = {
    ...program,
    updatedAt: new Date().toISOString(),
    category: path.dirname(path.relative(root, outFile)).replace(/\\/g, "/") || "",
  };
  await fs.writeFile(outFile, JSON.stringify(toWrite, null, 2), "utf-8");
  return {
    ok: true,
    rootPath: root,
    filePath: outFile,
    relativeFilePath: path.relative(root, outFile).replace(/\\/g, "/"),
    program: toWrite,
  };
});
