/* ================= Electro DAW | samplerDirectory.js ================= */
/* ---------------- sample bank Manager includ---------------- */
(function initSampleDirectory(global) {
  const STORAGE_KEY = "sls.sampler.roots.v1";
  const SUPPORTED_EXTENSIONS = new Set([".wav", ".mp3", ".ogg"]);

  const directoryState = {
    roots: [],
    activeRootPath: null,
    selectedSample: null,
    importedSample: null,
    dragSample: null,
  };

  function isElectronBridgeAvailable() {
    return Boolean(global.samplerFS?.pickDirectories && global.samplerFS?.scanDirectories);
  }

  function saveRootsToStorage() {
    if (!isElectronBridgeAvailable()) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(directoryState.roots.map((r) => r.rootPath)));
    } catch (error) {
      console.warn("[SamplerDirectory] localStorage write failed:", error);
    }
  }

  function loadRootPathsFromStorage() {
    if (!isElectronBridgeAvailable()) return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string" && x.length > 0) : [];
    } catch (error) {
      console.warn("[SamplerDirectory] localStorage parse failed:", error);
      return [];
    }
  }


  function isBrowserFolderPickerAvailable() {
    if (typeof global.showDirectoryPicker === "function") return true;
    const probe = document.createElement("input");
    probe.type = "file";
    return ("webkitdirectory" in probe) || ("directory" in probe);
  }

  function normalizeExt(fileName) {
    const idx = fileName.lastIndexOf(".");
    return idx >= 0 ? fileName.slice(idx).toLowerCase() : "";
  }

  async function scanBrowserDirectoryHandle(dirHandle, rootName) {
    const files = [];

    async function walk(handle, parentPath) {
      for await (const entry of handle.values()) {
        if (entry.kind === "directory") {
          await walk(entry, parentPath ? `${parentPath}/${entry.name}` : entry.name);
          continue;
        }

        if (entry.kind !== "file") continue;
        const ext = normalizeExt(entry.name);
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

        const file = await entry.getFile();
        const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        files.push({
          name: entry.name,
          ext,
          relativePath,
          path: relativePath,
          file,
          source: "browser",
        });
      }
    }

    await walk(dirHandle, "");

    return {
      rootPath: `browser://${rootName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      rootName,
      files,
      source: "browser",
    };
  }

  async function pickRootDirectoriesBrowser() {
    if (typeof global.showDirectoryPicker === "function") {
      const handle = await global.showDirectoryPicker({ mode: "read" });
      const root = await scanBrowserDirectoryHandle(handle, handle.name || "Folder");
      return { ok: true, roots: [root] };
    }

    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = true;
    picker.setAttribute("webkitdirectory", "");
    picker.setAttribute("directory", "");

    const files = await new Promise((resolve) => {
      picker.addEventListener("change", () => resolve(Array.from(picker.files || [])), { once: true });
      picker.click();
    });

    if (!files.length) return { ok: false, canceled: true };

    const byRoot = new Map();
    for (const file of files) {
      const rel = file.webkitRelativePath || file.name;
      const parts = rel.split("/");
      const rootName = parts[0] || "Folder";
      const relativePath = parts.slice(1).join("/") || file.name;
      const ext = normalizeExt(file.name);
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      if (!byRoot.has(rootName)) {
        byRoot.set(rootName, {
          rootPath: `browser://${rootName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          rootName,
          files: [],
          source: "browser",
        });
      }
      byRoot.get(rootName).files.push({
        name: file.name,
        ext,
        relativePath,
        path: relativePath,
        file,
        source: "browser",
      });
    }

    return { ok: true, roots: Array.from(byRoot.values()) };
  }

  async function scanRootsElectron(rootPaths) {
    return global.samplerFS.scanDirectories(rootPaths);
  }

  async function restorePersistedRoots() {
    if (!isElectronBridgeAvailable()) {
      emitChange();
      return { ok: true, roots: [] };
    }

    const savedPaths = loadRootPathsFromStorage();
    if (!savedPaths.length) return { ok: true, roots: [] };
    return rescanWithPaths(savedPaths);
  }

  async function rescanWithPaths(paths) {
    const result = await scanRootsElectron(paths);
    if (!result?.ok) return result;

    directoryState.roots = result.roots || [];
    if (!directoryState.roots.find((root) => root.rootPath === directoryState.activeRootPath)) {
      directoryState.activeRootPath = directoryState.roots[0]?.rootPath || null;
    }
    saveRootsToStorage();
    emitChange();
    return { ok: true, roots: directoryState.roots };
  }

  async function addRootsFromDialog() {
    if (isElectronBridgeAvailable()) {
      const picked = await global.samplerFS.pickDirectories();
      if (!picked?.ok) return picked || { ok: false, error: "Sélection annulée." };

      const currentPaths = directoryState.roots.map((root) => root.rootPath);
      const unique = [...new Set([...currentPaths, ...(picked.directories || [])])];
      return rescanWithPaths(unique);
    }

    try {
      if (!isBrowserFolderPickerAvailable()) {
        return { ok: false, error: "Sélection de dossier non supportée par ce navigateur. Utilisez Chrome/Edge ou l'app Electron." };
      }

      const pickedBrowser = await pickRootDirectoriesBrowser();
      if (!pickedBrowser?.ok) return pickedBrowser;

      const rootsByName = new Map(directoryState.roots.map((r) => [r.rootName, r]));
      for (const root of pickedBrowser.roots || []) rootsByName.set(root.rootName, root);
      directoryState.roots = Array.from(rootsByName.values());
      directoryState.activeRootPath = directoryState.activeRootPath || directoryState.roots[0]?.rootPath || null;
      emitChange();
      return { ok: true, roots: directoryState.roots };
    } catch (error) {
      if (error?.name === "AbortError") return { ok: false, canceled: true };
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function rescanCurrentRoots() {
    if (!isElectronBridgeAvailable()) {
      emitChange();
      return { ok: true, roots: directoryState.roots };
    }

    const paths = directoryState.roots.map((root) => root.rootPath);
    if (!paths.length) {
      emitChange();
      return { ok: true, roots: [] };
    }
    return rescanWithPaths(paths);
  }

  function removeRoot(rootPath) {
    directoryState.roots = directoryState.roots.filter((root) => root.rootPath !== rootPath);
    if (directoryState.activeRootPath === rootPath) {
      directoryState.activeRootPath = directoryState.roots[0]?.rootPath || null;
    }
    saveRootsToStorage();
    emitChange();
  }

  function setActiveRoot(rootPath) {
    directoryState.activeRootPath = rootPath;
    emitChange();
  }

  function selectSample(sample) {
    directoryState.selectedSample = sample || null;
    emitChange();
  }

  function setDragSample(sample) {
    directoryState.dragSample = sample || null;
  }

  function importSample(sample) {
    directoryState.importedSample = sample || null;
    emitChange();
  }

  function getActiveRoot() {
    return directoryState.roots.find((root) => root.rootPath === directoryState.activeRootPath) || null;
  }

  function emitChange() {
    global.dispatchEvent(new CustomEvent("sampler-directory:change", { detail: getSnapshot() }));
  }

  function getSnapshot() {
    return {
      roots: directoryState.roots,
      activeRootPath: directoryState.activeRootPath,
      activeRoot: getActiveRoot(),
      selectedSample: directoryState.selectedSample,
      importedSample: directoryState.importedSample,
      dragSample: directoryState.dragSample,
      mode: isElectronBridgeAvailable() ? "electron" : "browser",
    };
  }

  global.sampleDirectory = {
    state: directoryState,
    restorePersistedRoots,
    addRootsFromDialog,
    rescanCurrentRoots,
    setActiveRoot,
    removeRoot,
    selectSample,
    setDragSample,
    importSample,
    getSnapshot,
  };
})(window);
