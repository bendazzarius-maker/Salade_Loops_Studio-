/* ================= Electro DAW | sampler.js ================= */
/* name of custom Sampler is Saple To Key includ . */
(function initSamplerLibraryUI(global) {
  const directory = global.sampleDirectory;
  if (!directory) return;

  const rootsEl = document.getElementById("samplerRoots");
  const browserEl = document.getElementById("samplerBrowser");
  const rootLabelEl = document.getElementById("samplerRootLabel");
  const selectedNameEl = document.getElementById("samplerSelectedName");
  const previewEl = document.getElementById("samplerPreview");
  const dropZoneEl = document.getElementById("samplerDropZone");
  const dropStatusEl = document.getElementById("samplerDropStatus");
  const addRootBtn = document.getElementById("samplerAddRoot");
  const rescanBtn = document.getElementById("samplerRescan");

  function makeItemLabel(sample) {
    const rel = sample.relativePath || sample.name;
    return rel.length > 56 ? `${rel.slice(0, 53)}...` : rel;
  }

  function sampleToPreviewUrl(sample) {
    if (!sample?.path) return "";
    const normalized = sample.path.replace(/\\/g, "/");
    return `file://${encodeURI(normalized)}`;
  }

  function setStatus(message) {
    if (dropStatusEl) dropStatusEl.textContent = message;
  }

  function renderRoots(snapshot) {
    if (!rootsEl) return;
    rootsEl.innerHTML = "";
    if (!snapshot.roots.length) {
      rootsEl.innerHTML = '<div class="small">Aucun dossier configuré.</div>';
      return;
    }

    for (const root of snapshot.roots) {
      const btn = document.createElement("button");
      btn.className = "samplerItem" + (root.rootPath === snapshot.activeRootPath ? " active" : "");
      btn.type = "button";
      btn.innerHTML = `<span>${root.rootName}</span><span class="small">${root.files.length}</span>`;
      btn.title = root.rootPath;
      btn.addEventListener("click", () => directory.setActiveRoot(root.rootPath));
      rootsEl.appendChild(btn);
    }
  }

  function renderBrowser(snapshot) {
    if (!browserEl || !rootLabelEl) return;
    const activeRoot = snapshot.activeRoot;
    browserEl.innerHTML = "";

    if (!activeRoot) {
      rootLabelEl.textContent = "Aucun dossier sélectionné";
      browserEl.innerHTML = '<div class="small">Ajoutez un dossier pour indexer vos samples .wav/.mp3/.ogg.</div>';
      return;
    }

    rootLabelEl.textContent = `${activeRoot.rootName} — ${activeRoot.files.length} samples indexés`;
    if (!activeRoot.files.length) {
      browserEl.innerHTML = '<div class="small">Aucun fichier supporté trouvé dans ce dossier.</div>';
      return;
    }

    for (const sample of activeRoot.files) {
      const item = document.createElement("div");
      item.className = "samplerItem" + (snapshot.selectedSample?.path === sample.path ? " active" : "");
      item.draggable = true;
      item.innerHTML = `<span>${makeItemLabel(sample)}</span><span class="small">${sample.ext}</span>`;
      item.title = sample.relativePath || sample.name;

      item.addEventListener("click", () => {
        directory.selectSample(sample);
      });

      item.addEventListener("dragstart", (event) => {
        directory.setDragSample(sample);
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-sls-sample", JSON.stringify(sample));
        event.dataTransfer.setData("text/plain", sample.path);
      });

      browserEl.appendChild(item);
    }
  }

  function renderPreview(snapshot) {
    const selected = snapshot.selectedSample;
    if (!selected) {
      if (selectedNameEl) selectedNameEl.textContent = "Sélectionnez un sample pour pré-écoute.";
      if (previewEl) {
        previewEl.pause();
        previewEl.removeAttribute("src");
        previewEl.load();
      }
      return;
    }

    if (selectedNameEl) selectedNameEl.textContent = `Pré-écoute: ${selected.relativePath || selected.name}`;
    if (previewEl) {
      const newSrc = sampleToPreviewUrl(selected);
      if (previewEl.src !== newSrc) {
        previewEl.src = newSrc;
        previewEl.load();
      }
    }
  }

  function renderImported(snapshot) {
    const imported = snapshot.importedSample;
    if (!imported) {
      setStatus("Aucun sample importé.");
      return;
    }
    setStatus(`Import prêt: ${imported.relativePath || imported.name} (analyse pitch: étape suivante).`);
  }

  function render(snapshot) {
    renderRoots(snapshot);
    renderBrowser(snapshot);
    renderPreview(snapshot);
    renderImported(snapshot);
  }

  async function withBusyButton(button, job) {
    if (!button) return job();
    const prev = button.textContent;
    button.disabled = true;
    button.textContent = "...";
    try {
      return await job();
    } finally {
      button.disabled = false;
      button.textContent = prev;
    }
  }

  addRootBtn?.addEventListener("click", async () => {
    await withBusyButton(addRootBtn, async () => {
      const result = await directory.addRootsFromDialog();
      if (!result?.ok && !result?.canceled) {
        setStatus(`Erreur ajout dossier: ${result?.error || "inconnue"}`);
      }
    });
  });

  rescanBtn?.addEventListener("click", async () => {
    await withBusyButton(rescanBtn, async () => {
      const result = await directory.rescanCurrentRoots();
      if (!result?.ok) setStatus(`Erreur scan: ${result?.error || "inconnue"}`);
    });
  });

  dropZoneEl?.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZoneEl.classList.add("dragover");
  });

  dropZoneEl?.addEventListener("dragleave", () => {
    dropZoneEl.classList.remove("dragover");
  });

  dropZoneEl?.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZoneEl.classList.remove("dragover");

    let sample = directory.state.dragSample;
    const raw = event.dataTransfer.getData("application/x-sls-sample");
    if (!sample && raw) {
      try {
        sample = JSON.parse(raw);
      } catch (_error) {
        sample = null;
      }
    }

    if (!sample) {
      setStatus("Drop invalide: glissez un sample depuis le Browser.");
      return;
    }

    directory.importSample(sample);
  });

  global.addEventListener("sampler-directory:change", (event) => {
    render(event.detail || directory.getSnapshot());
  });

  directory.restorePersistedRoots().then(() => render(directory.getSnapshot()));
})(window);
