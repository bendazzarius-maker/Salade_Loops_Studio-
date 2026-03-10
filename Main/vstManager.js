/* ================= Electro DAW | vstManager.js ================= */
(function initVstManager(global) {
  const STORAGE_KEY = "sls.vst.roots.v1";
  const LIB_STORAGE_KEY = "sls.vst.library.v1";

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
    library: { fx: [], instruments: [] },
  };

  let rootsMenuEl = null;

  function _normPath(path) {
    return String(path || "").trim();
  }

  function _normPlugin(plugin) {
    const name = String(plugin?.name || "").trim() || "Plugin sans nom";
    const path = _normPath(plugin?.path);
    const category = classify(plugin);
    return { name, path, category };
  }

  function _uniquePlugins(items) {
    const out = [];
    const seen = new Set();
    (items || []).forEach((it) => {
      const norm = _normPlugin(it);
      const key = `${norm.name.toLowerCase()}::${norm.path.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(norm);
    });
    return out;
  }

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

  function saveLibrary() {
    try {
      const payload = {
        fx: _uniquePlugins(state.library.fx).map((p) => ({ name: p.name, path: p.path })),
        instruments: _uniquePlugins(state.library.instruments).map((p) => ({ name: p.name, path: p.path })),
      };
      localStorage.setItem(LIB_STORAGE_KEY, JSON.stringify(payload));
    } catch (_error) {}
  }

  function loadLibrary() {
    try {
      const raw = localStorage.getItem(LIB_STORAGE_KEY);
      if (!raw) return { fx: [], instruments: [] };
      const parsed = JSON.parse(raw);
      return {
        fx: _uniquePlugins(Array.isArray(parsed?.fx) ? parsed.fx.map((p) => ({ ...p, category: "fx" })) : []),
        instruments: _uniquePlugins(Array.isArray(parsed?.instruments) ? parsed.instruments.map((p) => ({ ...p, category: "instrument" })) : []),
      };
    } catch (_error) {
      return { fx: [], instruments: [] };
    }
  }

  function emitLibraryChange() {
    const detail = {
      fx: _uniquePlugins(state.library.fx),
      instruments: _uniquePlugins(state.library.instruments),
    };
    window.dispatchEvent(new CustomEvent("sls:vst-library-changed", { detail }));
  }

  function isInLibrary(plugin, target) {
    const n = _normPlugin(plugin);
    return (state.library[target] || []).some((item) => item.name === n.name && item.path === n.path);
  }

  function addToLibrary(plugin, target) {
    if (target !== "fx" && target !== "instruments") return;
    const n = _normPlugin(plugin);
    if (isInLibrary(n, target)) return;
    state.library[target].push({ name: n.name, path: n.path, category: target === "fx" ? "fx" : "instrument" });
    saveLibrary();
    emitLibraryChange();
    render();
  }

  function removeFromLibrary(plugin, target) {
    if (target !== "fx" && target !== "instruments") return;
    const n = _normPlugin(plugin);
    state.library[target] = (state.library[target] || []).filter((item) => !(item.name === n.name && item.path === n.path));
    saveLibrary();
    emitLibraryChange();
    render();
  }

  function clearLibrary() {
    state.library = { fx: [], instruments: [] };
    saveLibrary();
    emitLibraryChange();
    render();
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
      const kind = classify(plugin);
      const canAddFx = kind === "fx";
      const canAddInst = kind === "instrument";
      const fxAdded = canAddFx && isInLibrary(plugin, "fx");
      const instAdded = canAddInst && isInLibrary(plugin, "instruments");

      div.innerHTML = `${plugin.name}<span class="small">${plugin.path}</span>`;

      const actions = document.createElement("div");
      actions.className = "vstActions";

      if (canAddFx) {
        const btnFx = document.createElement("button");
        btnFx.className = "btn2";
        btnFx.textContent = fxAdded ? "✓ Dans FX Rack" : "+ Ajouter à FX Rack";
        btnFx.addEventListener("click", () => {
          if (isInLibrary(plugin, "fx")) removeFromLibrary(plugin, "fx");
          else addToLibrary(plugin, "fx");
        });
        actions.appendChild(btnFx);
      }

      if (canAddInst) {
        const btnInst = document.createElement("button");
        btnInst.className = "btn2";
        btnInst.textContent = instAdded ? "✓ Dans Channel Rack" : "+ Ajouter à Channel Rack";
        btnInst.addEventListener("click", () => {
          if (isInLibrary(plugin, "instruments")) removeFromLibrary(plugin, "instruments");
          else addToLibrary(plugin, "instruments");
        });
        actions.appendChild(btnInst);
      }

      if (actions.childElementCount > 0) div.appendChild(actions);
      container.appendChild(div);
    });
  }

  function closeRootsContextMenu() {
    if (rootsMenuEl && rootsMenuEl.parentNode) rootsMenuEl.parentNode.removeChild(rootsMenuEl);
    rootsMenuEl = null;
  }

  function showRootsContextMenu(x, y, rootPath) {
    closeRootsContextMenu();
    const menu = document.createElement("div");
    menu.className = "vstContextMenu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const mkItem = (label, onClick, danger = false) => {
      const b = document.createElement("button");
      b.className = "vstContextItem" + (danger ? " danger" : "");
      b.textContent = label;
      b.addEventListener("click", () => {
        onClick();
        closeRootsContextMenu();
      });
      return b;
    };

    menu.appendChild(mkItem("🗑️ Supprimer ce chemin", async () => {
      const next = state.roots.map((r) => r.rootPath).filter((p) => p !== rootPath);
      await scan(next);
    }, true));

    menu.appendChild(mkItem("♻️ Réinitialiser tous les chemins", async () => {
      state.roots = [];
      state.activeRootPath = null;
      saveRoots();
      render();
    }, true));

    menu.appendChild(mkItem("🧹 Vider bibliothèque validée", () => {
      clearLibrary();
    }, true));

    document.body.appendChild(menu);
    rootsMenuEl = menu;

    setTimeout(() => {
      const dismiss = (evt) => {
        if (!menu.contains(evt.target)) {
          closeRootsContextMenu();
          document.removeEventListener("mousedown", dismiss);
          document.removeEventListener("scroll", dismiss, true);
        }
      };
      document.addEventListener("mousedown", dismiss);
      document.addEventListener("scroll", dismiss, true);
    }, 0);
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
      btn.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        showRootsContextMenu(event.clientX, event.clientY, root.rootPath);
      });
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

  state.library = loadLibrary();
  global.vstLibrary = {
    getAll() {
      return {
        fx: _uniquePlugins(state.library.fx),
        instruments: _uniquePlugins(state.library.instruments),
      };
    },
    clear: clearLibrary,
  };
  emitLibraryChange();

  scan(loadRoots()).catch(() => {});
})(window);
