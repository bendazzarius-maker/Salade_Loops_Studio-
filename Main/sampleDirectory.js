/* ================= Electro DAW | samplerDirectory.js ================= */
/* ---------------- sample bank Manager includ---------------- */
(function initSampleDirectory(global) {
  const STORAGE_KEY = "sls.sampler.roots.v1";
  const PROGRAMS_KEY = "sls.sampler.programs.v1";

  const directoryState = {
    roots: [],
    activeRootPath: null,
    selectedSample: null,
    importedSample: null,
    dragSample: null,
    programs: [],
    activeProgramId: null,
  };

  function uid(prefix = "sp") {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
  }

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

  function saveProgramsToStorage() {
    try {
      const payload = {
        activeProgramId: directoryState.activeProgramId,
        programs: directoryState.programs,
      };
      localStorage.setItem(PROGRAMS_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn("[SamplerDirectory] program storage write failed:", error);
    }
  }

  function loadProgramsFromStorage() {
    try {
      const raw = localStorage.getItem(PROGRAMS_KEY);
      if (!raw) return { programs: [], activeProgramId: null };
      const parsed = JSON.parse(raw);
      const programs = Array.isArray(parsed?.programs) ? parsed.programs.filter((x) => x && typeof x === "object") : [];
      const activeProgramId = typeof parsed?.activeProgramId === "string" ? parsed.activeProgramId : null;
      return { programs, activeProgramId };
    } catch (error) {
      console.warn("[SamplerDirectory] program storage parse failed:", error);
      return { programs: [], activeProgramId: null };
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
    const storedPrograms = loadProgramsFromStorage();
    directoryState.programs = storedPrograms.programs;
    directoryState.activeProgramId = storedPrograms.activeProgramId;

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

  function saveProgram(programData) {
    if (!programData || typeof programData !== "object") {
      return { ok: false, error: "programData invalide" };
    }
    const id = typeof programData.id === "string" && programData.id ? programData.id : uid("sampler");
    const name = String(programData.name || "Sampler Program").trim();
    const next = {
      id,
      name: name || "Sampler Program",
      sample: programData.sample || null,
      rootMidi: Number.isFinite(+programData.rootMidi) ? +programData.rootMidi : null,
      rootHz: Number.isFinite(+programData.rootHz) ? +programData.rootHz : null,
      loopStartPct: Number.isFinite(+programData.loopStartPct) ? +programData.loopStartPct : 15,
      loopEndPct: Number.isFinite(+programData.loopEndPct) ? +programData.loopEndPct : 90,
      sustainPct: Number.isFinite(+programData.sustainPct) ? +programData.sustainPct : 72,
      updatedAt: new Date().toISOString(),
    };

    const index = directoryState.programs.findIndex((x) => x.id === id || x.name === next.name);
    if (index >= 0) directoryState.programs[index] = next;
    else directoryState.programs.push(next);

    directoryState.activeProgramId = next.id;
    saveProgramsToStorage();
    emitChange();
    return { ok: true, program: next };
  }

  function setActiveProgram(programId) {
    directoryState.activeProgramId = programId || null;
    saveProgramsToStorage();
    emitChange();
  }

  function importPrograms(payload, merge = true) {
    if (!payload) return { ok: false, error: "payload absent" };
    const incoming = Array.isArray(payload.programs) ? payload.programs : [];
    directoryState.programs = merge ? [...directoryState.programs] : [];
    for (const entry of incoming) {
      saveProgram({ ...entry, id: entry.id || uid("sampler") });
    }
    if (!merge) {
      directoryState.activeProgramId = payload.activeProgramId || directoryState.programs[0]?.id || null;
      saveProgramsToStorage();
      emitChange();
    }
    return { ok: true };
  }

  function exportPrograms() {
    return {
      activeProgramId: directoryState.activeProgramId,
      programs: directoryState.programs.slice(),
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
    listPrograms,
    getProgram,
    saveProgram,
    setActiveProgram,
    importPrograms,
    exportPrograms,
    getSnapshot,
  };
})(window);
