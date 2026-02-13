/* ================= Electro DAW | samplerDirectory.js ================= */
/* ---------------- sample bank Manager includ---------------- */
(function initSampleDirectory(global) {
  const STORAGE_KEY = "sls.sampler.roots.v1";
  const LAST_CATEGORY_KEY = "sls.sampler.category.v1";

  const directoryState = {
    roots: [],
    activeRootPath: null,
    selectedSample: null,
    importedSample: null,
    dragSample: null,
    programs: [],
    activeProgramId: null,
    programsRootPath: null,
    categories: [""],
    activeCategory: "",
    autoRefreshTimer: null,
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

  function loadLastCategory() {
    try {
      return String(localStorage.getItem(LAST_CATEGORY_KEY) || "");
    } catch (_error) {
      return "";
    }
  }

  function saveLastCategory(value) {
    try {
      localStorage.setItem(LAST_CATEGORY_KEY, String(value || ""));
    } catch (_error) {}
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

  async function refreshProgramsFromDisk() {
    if (!global.samplerFS?.listPrograms) return { ok: false, error: "listPrograms indisponible" };
    const result = await global.samplerFS.listPrograms();
    if (!result?.ok) return result || { ok: false, error: "Erreur de scan programmes" };

    const programs = Array.isArray(result.programs) ? result.programs.filter((x) => x && typeof x === "object") : [];
    const categories = new Set([""]);
    for (const p of programs) categories.add(String(p.category || ""));

    directoryState.programsRootPath = result.rootPath || null;
    directoryState.programs = programs;
    directoryState.categories = Array.from(categories).sort((a, b) => a.localeCompare(b));

    if (!directoryState.programs.find((p) => p.id === directoryState.activeProgramId)) {
      directoryState.activeProgramId = directoryState.programs[0]?.id || null;
    }
    if (!directoryState.categories.includes(directoryState.activeCategory)) {
      directoryState.activeCategory = "";
      saveLastCategory("");
    }
    emitChange();
    return { ok: true, programs: directoryState.programs, rootPath: directoryState.programsRootPath };
  }

  function ensureAutoRefresh() {
    if (directoryState.autoRefreshTimer) return;
    directoryState.autoRefreshTimer = setInterval(() => {
      refreshProgramsFromDisk().catch(() => {});
    }, 3500);
  }

  async function restorePersistedRoots() {
    directoryState.activeCategory = loadLastCategory();
    await refreshProgramsFromDisk();
    ensureAutoRefresh();

    const savedPaths = loadRootPathsFromStorage();
    if (!savedPaths.length) {
      emitChange();
      return { ok: true, roots: [] };
    }
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

  function listPrograms() {
    return directoryState.programs.slice();
  }

  function getProgram(programId) {
    if (!programId) return null;
    return directoryState.programs.find((x) => x.id === programId) || null;
  }

  async function createCategory(relativeDir) {
    if (!global.samplerFS?.createCategory) return { ok: false, error: "createCategory indisponible" };
    const result = await global.samplerFS.createCategory(relativeDir);
    if (result?.ok) {
      directoryState.activeCategory = String(result.relativeDir || "");
      saveLastCategory(directoryState.activeCategory);
      await refreshProgramsFromDisk();
    }
    return result;
  }

  async function saveProgram(programData, options = {}) {
    if (!programData || typeof programData !== "object") {
      return { ok: false, error: "programData invalide" };
    }
    if (!global.samplerFS?.saveProgram) {
      return { ok: false, error: "saveProgram indisponible" };
    }

    const payload = {
      program: { ...programData },
      mode: options.mode === "update" ? "update" : "saveAs",
      relativeDir: String(options.relativeDir || directoryState.activeCategory || ""),
      targetFilePath: options.targetFilePath || null,
    };
    const result = await global.samplerFS.saveProgram(payload);
    if (!result?.ok) return result || { ok: false, error: "saveProgram échec" };

    directoryState.activeProgramId = result.program?.id || result.relativeFilePath || null;
    if (payload.relativeDir != null) {
      directoryState.activeCategory = String(payload.relativeDir || "");
      saveLastCategory(directoryState.activeCategory);
    }
    await refreshProgramsFromDisk();
    return { ok: true, program: getProgram(directoryState.activeProgramId) || result.program, filePath: result.filePath, relativeFilePath: result.relativeFilePath };
  }

  function setActiveProgram(programId) {
    directoryState.activeProgramId = programId || null;
    emitChange();
  }

  function setActiveCategory(relativeDir) {
    directoryState.activeCategory = String(relativeDir || "");
    saveLastCategory(directoryState.activeCategory);
    emitChange();
  }

  function importPrograms(payload, merge = true) {
    if (!payload || !Array.isArray(payload.programs)) return { ok: false, error: "payload absent" };
    directoryState.programs = merge ? [...directoryState.programs, ...payload.programs] : payload.programs.slice();
    if (!directoryState.activeProgramId) directoryState.activeProgramId = payload.activeProgramId || directoryState.programs[0]?.id || null;
    emitChange();
    return { ok: true };
  }

  function exportPrograms() {
    return {
      activeProgramId: directoryState.activeProgramId,
      programs: directoryState.programs.slice(),
      programsRootPath: directoryState.programsRootPath,
      categories: directoryState.categories.slice(),
      activeCategory: directoryState.activeCategory,
    };
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
      programs: listPrograms(),
      activeProgramId: directoryState.activeProgramId,
      activeProgram: getProgram(directoryState.activeProgramId),
      programsRootPath: directoryState.programsRootPath,
      categories: directoryState.categories.slice(),
      activeCategory: directoryState.activeCategory,
    };
  }

  global.sampleDirectory = {
    state: directoryState,
    restorePersistedRoots,
    refreshProgramsFromDisk,
    addRootsFromDialog,
    rescanCurrentRoots,
    setActiveRoot,
    selectSample,
    setDragSample,
    importSample,
    listPrograms,
    getProgram,
    createCategory,
    saveProgram,
    setActiveProgram,
    setActiveCategory,
    importPrograms,
    exportPrograms,
    getSnapshot,
  };
})(window);
