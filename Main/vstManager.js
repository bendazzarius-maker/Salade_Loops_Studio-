/* ================= Electro DAW | vstManager.js ================= */
(function initVstManager(global) {
  const STORAGE_KEY = "sls.vst.roots.v1";

  const rootsEl = document.getElementById("vstRoots");
  const addRootBtn = document.getElementById("vstAddRoot");
  const rescanBtn = document.getElementById("vstRescan");
  const fxListEl = document.getElementById("vstFxList");
  const instListEl = document.getElementById("vstInstrumentList");
  const unknownListEl = document.getElementById("vstUnknownList");
  const countsEl = document.getElementById("vstCounts");

  if (!rootsEl || !addRootBtn || !rescanBtn || !fxListEl || !instListEl || !unknownListEl || !countsEl) return;

  const state = {
    roots: [],
    activeRootPath: null,
  };

  function saveRoots() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.roots.map((r) => r.rootPath)));
    } catch (_error) {}
  }

  function loadRoots() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string" && x.trim()) : [];
    } catch (_error) {
      return [];
    }
  }

  function allPlugins() {
    return state.roots.flatMap((root) => Array.isArray(root.files) ? root.files : []);
  }

  function classify(plugin) {
    const c = String(plugin?.category || "unknown");
    if (c === "fx" || c === "instrument") return c;
    return "unknown";
  }

  function renderPluginList(container, items) {
    container.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "small";
      empty.textContent = "Aucun plugin";
      container.appendChild(empty);
      return;
    }

    items.forEach((plugin) => {
      const div = document.createElement("div");
      div.className = "vstItem";
      div.innerHTML = `${plugin.name}<span class="small">${plugin.path}</span>`;
      container.appendChild(div);
    });
  }

  function render() {
    rootsEl.innerHTML = "";
    state.roots.forEach((root) => {
      const btn = document.createElement("button");
      btn.className = "samplerItem" + (root.rootPath === state.activeRootPath ? " active" : "");
      const count = Array.isArray(root.files) ? root.files.length : 0;
      btn.innerHTML = `<span>${root.rootName || root.rootPath}</span><span class="small">${count}</span>`;
      btn.onclick = () => {
        state.activeRootPath = root.rootPath;
        render();
      };
      rootsEl.appendChild(btn);
    });

    const plugins = allPlugins();
    const fx = plugins.filter((p) => classify(p) === "fx");
    const inst = plugins.filter((p) => classify(p) === "instrument");
    const unknown = plugins.filter((p) => classify(p) === "unknown");

    countsEl.textContent = `${plugins.length} plugin(s) • FX: ${fx.length} • Instrument: ${inst.length} • Non classé: ${unknown.length}`;
    renderPluginList(fxListEl, fx);
    renderPluginList(instListEl, inst);
    renderPluginList(unknownListEl, unknown);
  }

  async function scan(paths) {
    if (!global.vstFS?.scanDirectories) return;
    const result = await global.vstFS.scanDirectories(paths);
    if (!result?.ok) return;
    state.roots = Array.isArray(result.roots) ? result.roots : [];
    state.activeRootPath = state.roots[0]?.rootPath || null;
    saveRoots();
    render();
  }

  addRootBtn.addEventListener("click", async () => {
    const picked = await global.vstFS?.pickDirectories?.();
    if (!picked?.ok) return;
    const unique = [...new Set([...state.roots.map((r) => r.rootPath), ...(picked.directories || [])])];
    await scan(unique);
  });

  rescanBtn.addEventListener("click", async () => {
    await scan(state.roots.map((r) => r.rootPath));
  });

  scan(loadRoots()).catch(() => {});
})(window);
