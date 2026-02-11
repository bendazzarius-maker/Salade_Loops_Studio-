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
  const waveformEl = document.getElementById("samplerWaveform");
  const editorInfoEl = document.getElementById("samplerEditorInfo");
  const baseNoteEl = document.getElementById("samplerBaseNote");
  const loopStartEl = document.getElementById("samplerLoopStart");
  const loopEndEl = document.getElementById("samplerLoopEnd");
  const crossfadeEl = document.getElementById("samplerCrossfade");
  const analyzeBtn = document.getElementById("samplerAnalyzePitch");
  const pitchResultEl = document.getElementById("samplerPitchResult");
  const keyLowEl = document.getElementById("samplerKeyLow");
  const keyHighEl = document.getElementById("samplerKeyHigh");
  const keyMapEl = document.getElementById("samplerKeyMap");

  const editorState = {
    audioBuffer: null,
    sourceBlobUrl: "",
    imported: null,
    detectedHz: null,
    detectedMidi: null,
  };

  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  for (let midi = 24; midi <= 96; midi += 1) {
    const octave = Math.floor(midi / 12) - 1;
    const noteName = `${noteNames[midi % 12]}${octave}`;
    const opt = document.createElement("option");
    opt.value = String(midi);
    opt.textContent = noteName;
    if (midi === 60) opt.selected = true;
    baseNoteEl?.appendChild(opt);
  }

  function midiToName(midi) {
    const octave = Math.floor(midi / 12) - 1;
    return `${noteNames[midi % 12]}${octave}`;
  }

  for (let midi = 24; midi <= 96; midi += 1) {
    const optLow = document.createElement("option");
    optLow.value = String(midi);
    optLow.textContent = midiToName(midi);
    if (midi === 36) optLow.selected = true;
    keyLowEl?.appendChild(optLow);

    const optHigh = document.createElement("option");
    optHigh.value = String(midi);
    optHigh.textContent = midiToName(midi);
    if (midi === 84) optHigh.selected = true;
    keyHighEl?.appendChild(optHigh);
  }

  function setStatus(message) {
    if (dropStatusEl) dropStatusEl.textContent = message;
  }

  function makeItemLabel(sample) {
    const rel = sample.relativePath || sample.name;
    return rel.length > 56 ? `${rel.slice(0, 53)}...` : rel;
  }

  function drawWaveform() {
    if (!waveformEl) return;
    const ctx = waveformEl.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, waveformEl.width, waveformEl.height);
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, waveformEl.width, waveformEl.height);

    if (!editorState.audioBuffer) {
      ctx.fillStyle = "rgba(147,164,199,.9)";
      ctx.font = "12px sans-serif";
      ctx.fillText("Importez un sample pour afficher la forme d'onde", 14, 24);
      return;
    }

    const data = editorState.audioBuffer.getChannelData(0);
    const { width, height } = waveformEl;
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    ctx.strokeStyle = "rgba(112,167,255,.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < width; i += 1) {
      let min = 1;
      let max = -1;
      for (let j = 0; j < step; j += 1) {
        const val = data[i * step + j] || 0;
        if (val < min) min = val;
        if (val > max) max = val;
      }
      ctx.moveTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }
    ctx.stroke();

    const loopStart = Number(loopStartEl?.value || 0) / 100;
    const loopEnd = Number(loopEndEl?.value || 100) / 100;
    ctx.fillStyle = "rgba(39,224,163,.15)";
    ctx.fillRect(Math.floor(width * loopStart), 0, Math.max(1, Math.floor(width * (loopEnd - loopStart))), height);
  }

  async function getSampleBlob(sample) {
    if (!sample) return null;

    if (sample.file instanceof File) {
      return sample.file;
    }

    if (!sample.path) return null;
    if (!global.samplerFS?.readFile) return null;
    const result = await global.samplerFS.readFile(sample.path);
    if (!result?.ok || !result.data) return null;

    const bytes = Uint8Array.from(atob(result.data), (ch) => ch.charCodeAt(0));
    return new Blob([bytes], { type: result.mime || "audio/*" });
  }

  async function loadEditorSample(sample) {
    if (!sample) return;
    let blob = await getSampleBlob(sample);
    if (!blob && sample.path) {
      setStatus("Mode fallback: aperçu direct depuis chemin fichier.");
      return;
    }

    if (!blob) {
      setStatus("Impossible de charger ce sample.");
      return;
    }

    if (editorState.sourceBlobUrl) URL.revokeObjectURL(editorState.sourceBlobUrl);
    const url = URL.createObjectURL(blob);
    editorState.sourceBlobUrl = url;

    if (previewEl) {
      previewEl.src = url;
      previewEl.load();
    }

    const ac = new (global.AudioContext || global.webkitAudioContext)();
    const arr = await blob.arrayBuffer();
    editorState.audioBuffer = await ac.decodeAudioData(arr.slice(0));
    await ac.close();

    if (editorInfoEl) {
      editorInfoEl.textContent = `Durée: ${editorState.audioBuffer.duration.toFixed(2)}s • Base note: ${baseNoteEl?.selectedOptions?.[0]?.textContent || "C4"}`;
    }
    editorState.detectedHz = null;
    editorState.detectedMidi = null;
    updatePitchResult();
    drawWaveform();
    renderKeyMap();
  }


  function detectFundamentalHz(channelData, sampleRate) {
    if (!channelData?.length) return null;
    const size = Math.min(channelData.length, 65536);
    const offset = Math.max(0, Math.floor((channelData.length - size) / 2));
    const frame = channelData.slice(offset, offset + size);
    let rms = 0;
    for (let i = 0; i < frame.length; i += 1) rms += frame[i] * frame[i];
    rms = Math.sqrt(rms / frame.length);
    if (rms < 0.01) return null;

    let bestLag = -1;
    let bestCorr = 0;
    const minLag = Math.floor(sampleRate / 1200);
    const maxLag = Math.floor(sampleRate / 50);
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let corr = 0;
      for (let i = 0; i < frame.length - lag; i += 1) corr += frame[i] * frame[i + lag];
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    if (bestLag <= 0) return null;
    return sampleRate / bestLag;
  }

  function hzToMidi(hz) {
    return 69 + 12 * Math.log2(hz / 440);
  }

  function renderKeyMap() {
    if (!keyMapEl) return;
    const rootMidi = Number(baseNoteEl?.value || 60);
    let low = Number(keyLowEl?.value || 36);
    let high = Number(keyHighEl?.value || 84);
    if (low > high) {
      [low, high] = [high, low];
      if (keyLowEl) keyLowEl.value = String(low);
      if (keyHighEl) keyHighEl.value = String(high);
    }

    keyMapEl.innerHTML = "";
    for (let midi = low; midi <= high; midi += 1) {
      const ratio = 2 ** ((midi - rootMidi) / 12);
      const row = document.createElement("div");
      row.className = "samplerMapRow";
      row.innerHTML = `<span>${midiToName(midi)}</span><span>x${ratio.toFixed(3)}</span>`;
      keyMapEl.appendChild(row);
    }
  }

  function updatePitchResult() {
    if (!pitchResultEl) return;
    if (!editorState.detectedHz || !Number.isFinite(editorState.detectedMidi)) {
      pitchResultEl.textContent = "Aucune analyse.";
      return;
    }
    const nearest = Math.round(editorState.detectedMidi);
    const cents = Math.round((editorState.detectedMidi - nearest) * 100);
    pitchResultEl.textContent = `Root détecté: ${midiToName(nearest)} • ${editorState.detectedHz.toFixed(2)} Hz • ${cents >= 0 ? "+" : ""}${cents} cents`;
  }

  function renderRoots(snapshot) {
    if (!rootsEl) return;
    rootsEl.innerHTML = "";
    if (!snapshot.roots.length) {
      rootsEl.innerHTML = '<div class="small">Aucun dossier configuré. Cliquez sur + Ajouter dossier.</div>';
      return;
    }

    for (const root of snapshot.roots) {
      const row = document.createElement("div");
      row.className = "samplerItem" + (root.rootPath === snapshot.activeRootPath ? " active" : "");
      row.innerHTML = `<span title="${root.rootPath}">${root.rootName}</span><span class="small">${root.files.length}</span>`;
      row.addEventListener("click", () => directory.setActiveRoot(root.rootPath));

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btnTiny";
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        directory.removeRoot(root.rootPath);
      });
      row.appendChild(removeBtn);
      rootsEl.appendChild(row);
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
    if (activeRoot.error) {
      browserEl.innerHTML = `<div class="small">Erreur scan: ${activeRoot.error}</div>`;
      return;
    }
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
      item.addEventListener("click", async () => {
        directory.selectSample(sample);
        await loadEditorSample(sample);
      });
      item.addEventListener("dragstart", (event) => {
        directory.setDragSample(sample);
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-sls-sample", JSON.stringify(sample));
      });
      browserEl.appendChild(item);
    }
  }

  function renderImported(snapshot) {
    const imported = snapshot.importedSample;
    if (!imported) {
      setStatus("Aucun sample importé.");
      return;
    }
    editorState.imported = imported;
    setStatus(`Import prêt: ${imported.relativePath || imported.name} (analyse pitch: étape suivante).`);
    loadEditorSample(imported).catch((err) => setStatus(`Erreur éditeur: ${err?.message || err}`));
  }

  function render(snapshot) {
    renderRoots(snapshot);
    renderBrowser(snapshot);
    if (rootLabelEl && snapshot.mode === "browser") {
      rootLabelEl.textContent = `${rootLabelEl.textContent} • mode navigateur`;
    }
    if (selectedNameEl) {
      selectedNameEl.textContent = snapshot.selectedSample
        ? `Pré-écoute: ${snapshot.selectedSample.relativePath || snapshot.selectedSample.name}`
        : "Sélectionnez un sample pour pré-écoute.";
    }
    renderImported(snapshot);
    drawWaveform();
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
        setStatus(`Erreur ajout dossier: ${result?.error || "Impossible d'ouvrir le sélecteur de dossier."}`);
      } else if (result?.ok) {
        setStatus("Dossier(s) ajouté(s) et indexé(s).");
      }
    });
  });

  rescanBtn?.addEventListener("click", async () => {
    await withBusyButton(rescanBtn, async () => {
      const result = await directory.rescanCurrentRoots();
      if (!result?.ok) setStatus(`Erreur scan: ${result?.error || "inconnue"}`);
      else setStatus("Index mis à jour.");
    });
  });

  [baseNoteEl, keyLowEl, keyHighEl, loopStartEl, loopEndEl, crossfadeEl].forEach((el) => {
    el?.addEventListener("input", () => {
      if (loopStartEl && loopEndEl && Number(loopStartEl.value) >= Number(loopEndEl.value)) {
        loopEndEl.value = String(Math.min(100, Number(loopStartEl.value) + 1));
      }
      drawWaveform();
      renderKeyMap();
    });
  });


  analyzeBtn?.addEventListener("click", () => {
    if (!editorState.audioBuffer) {
      setStatus("Chargez d'abord un sample dans l'éditeur.");
      return;
    }
    const channel = editorState.audioBuffer.getChannelData(0);
    const hz = detectFundamentalHz(channel, editorState.audioBuffer.sampleRate);
    if (!hz) {
      setStatus("Analyse impossible: signal trop faible ou non tonal.");
      return;
    }
    const midiFloat = hzToMidi(hz);
    const nearest = Math.round(midiFloat);
    editorState.detectedHz = hz;
    editorState.detectedMidi = midiFloat;
    if (baseNoteEl) baseNoteEl.value = String(nearest);
    updatePitchResult();
    renderKeyMap();
    setStatus(`Analyse terminée: ${midiToName(nearest)} (${hz.toFixed(2)} Hz)`);
  });

  dropZoneEl?.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZoneEl.classList.add("dragover");
  });
  dropZoneEl?.addEventListener("dragleave", () => dropZoneEl.classList.remove("dragover"));
  dropZoneEl?.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZoneEl.classList.remove("dragover");
    let sample = directory.state.dragSample;
    const raw = event.dataTransfer.getData("application/x-sls-sample");
    if (!sample && raw) {
      try { sample = JSON.parse(raw); } catch (_err) { sample = null; }
    }
    if (!sample) return setStatus("Drop invalide: glissez un sample depuis le Browser.");
    directory.importSample(sample);
  });

  global.addEventListener("sampler-directory:change", (event) => {
    render(event.detail || directory.getSnapshot());
  });

  directory.restorePersistedRoots()
    .then((result) => {
      if (!result?.ok) setStatus(`Erreur initialisation: ${result?.error || "inconnue"}`);
      else if (result.mode === "browser" || directory.getSnapshot().mode === "browser") setStatus("Mode navigateur: choisissez un dossier via le sélecteur système.");
      render(directory.getSnapshot());
      renderKeyMap();
    })
    .catch((err) => setStatus(`Erreur initialisation: ${err?.message || err}`));
})(window);
