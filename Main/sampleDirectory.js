/* ================= Electro DAW | samplerDirectory.js ================= */
/* ---------------- sample bank Manager includ---------------- */
(function initSampleDirectory(global) {
  const STORAGE_KEY = "sls.sampler.roots.v1";

  const directoryState = {
    roots: [],
    activeRootPath: null,
    selectedSample: null,
    importedSample: null,
    dragSample: null,
  };

  function saveRootsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(directoryState.roots.map((r) => r.rootPath)));
    } catch (error) {
      console.warn("[SamplerDirectory] localStorage write failed:", error);
    }
  }

  function loadRootPathsFromStorage() {
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

  async function pickRootDirectories() {
    if (!global.samplerFS?.pickDirectories) {
      return { ok: false, error: "samplerFS indisponible dans ce contexte." };
    }
    return global.samplerFS.pickDirectories();
  }

  async function scanRoots(rootPaths) {
    if (!global.samplerFS?.scanDirectories) {
      return { ok: false, error: "scanDirectories indisponible." };
    }
    return global.samplerFS.scanDirectories(rootPaths);
  }

  async function restorePersistedRoots() {
    const savedPaths = loadRootPathsFromStorage();
    if (!savedPaths.length) return { ok: true, roots: [] };
    return rescanWithPaths(savedPaths);
  }

  async function rescanWithPaths(paths) {
    const result = await scanRoots(paths);
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
    const picked = await pickRootDirectories();
    if (!picked?.ok) return picked || { ok: false, error: "Sélection annulée." };

    const currentPaths = directoryState.roots.map((root) => root.rootPath);
    const unique = [...new Set([...currentPaths, ...(picked.directories || [])])];
    return rescanWithPaths(unique);
  }

  async function rescanCurrentRoots() {
    const paths = directoryState.roots.map((root) => root.rootPath);
    if (!paths.length) return { ok: true, roots: [] };
    return rescanWithPaths(paths);
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
    };
  }

  global.sampleDirectory = {
    state: directoryState,
    restorePersistedRoots,
    addRootsFromDialog,
    rescanCurrentRoots,
    setActiveRoot,
    selectSample,
    setDragSample,
    importSample,
    getSnapshot,
  };
})(window);
