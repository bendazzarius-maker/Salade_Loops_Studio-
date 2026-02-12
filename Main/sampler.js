/* ================= Electro DAW | sampler.js ================= */
/* Sampler Touski editor + library */
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
  const rootNoteEl = document.getElementById("samplerRootNote");
  const rootHzEl = document.getElementById("samplerRootHz");
  const waveCanvas = document.getElementById("samplerWaveCanvas");
  const pianoMapEl = document.getElementById("samplerPianoMap");
  const loopStatusEl = document.getElementById("samplerLoopStatus");
  const loopStartEl = document.getElementById("samplerLoopStart");
  const loopEndEl = document.getElementById("samplerLoopEnd");
  const sustainEl = document.getElementById("samplerSustain");
  const programNameEl = document.getElementById("samplerProgramName");
  const saveProgramBtn = document.getElementById("samplerSaveProgram");
  const programListEl = document.getElementById("samplerProgramList");

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  let audioCtx = null;
  let analysisToken = 0;
  let analysisState = null;
  let lastAnalyzedPath = "";

  function midiToName(midi) {
    const idx = ((midi % 12) + 12) % 12;
    const oct = Math.floor(midi / 12) - 1;
    return `${NOTE_NAMES[idx]}${oct}`;
  }

  function frequencyToMidi(freq) {
    if (!isFinite(freq) || freq <= 0) return null;
    return Math.round(69 + (12 * Math.log2(freq / 440)));
  }

  function midiToFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function formatHz(freq) {
    if (!isFinite(freq) || freq <= 0) return "—";
    return `${freq.toFixed(2)} Hz`;
  }

  function makeItemLabel(sample) {
    const rel = sample.relativePath || sample.name;
    return rel.length > 56 ? `${rel.slice(0, 53)}...` : rel;
  }

  function sampleSuggestedProgramName(sample) {
    const raw = sample?.name || sample?.relativePath || "";
    if (!raw) return "";
    return String(raw).replace(/\.[a-z0-9]+$/i, "").trim();
  }

  function sampleToPreviewUrl(sample) {
    if (!sample?.path) return "";
    const normalized = sample.path.replace(/\\/g, "/");
    return `file://${encodeURI(normalized)}`;
  }

  function setStatus(message) {
    if (dropStatusEl) dropStatusEl.textContent = message;
  }

  function setLoopStatus(message) {
    if (loopStatusEl) loopStatusEl.textContent = message;
  }

  function updateLoopStatus() {
    const start = Number(loopStartEl?.value || 0);
    const end = Number(loopEndEl?.value || 100);
    const sustain = Number(sustainEl?.value || 70);
    if (end <= start + 2) {
      setLoopStatus("Loop invalide: Loop End doit être > Loop Start + 2.");
      return;
    }
    setLoopStatus(`Sustain editor: loop ${start}% → ${end}% • sustain ${sustain}%`);
  }

  function ensureAudioContext() {
    if (!audioCtx) {
      const Ctor = global.AudioContext || global.webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    return audioCtx;
  }

  async function loadSampleBuffer(sample) {
    if (!sample?.path) return null;
    const response = await fetch(sampleToPreviewUrl(sample));
    const arrayBuffer = await response.arrayBuffer();
    const ctx = ensureAudioContext();
    if (!ctx) return null;
    return ctx.decodeAudioData(arrayBuffer.slice(0));
  }

  function detectRootFrequency(buffer) {
    if (!buffer) return null;
    const channel = buffer.numberOfChannels ? buffer.getChannelData(0) : null;
    if (!channel?.length) return null;

    const sr = buffer.sampleRate || 44100;
    const winSize = Math.min(4096, channel.length);
    const offset = Math.max(0, Math.floor(channel.length * 0.08));
    const chunk = channel.subarray(offset, Math.min(offset + winSize, channel.length));
    if (chunk.length < 200) return null;

    let rms = 0;
    for (let i = 0; i < chunk.length; i += 1) rms += chunk[i] * chunk[i];
    rms = Math.sqrt(rms / chunk.length);
    if (rms < 0.004) return null;

    const minHz = 40;
    const maxHz = 1200;
    const minLag = Math.max(2, Math.floor(sr / maxHz));
    const maxLag = Math.min(chunk.length - 1, Math.floor(sr / minHz));

    let bestLag = -1;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let corr = 0;
      let normA = 0;
      let normB = 0;
      const end = chunk.length - lag;
      for (let i = 0; i < end; i += 1) {
        const a = chunk[i];
        const b = chunk[i + lag];
        corr += a * b;
        normA += a * a;
        normB += b * b;
      }
      const denom = Math.sqrt(normA * normB) || 1;
      const score = corr / denom;
      if (score > bestCorr) {
        bestCorr = score;
        bestLag = lag;
      }
    }
    if (bestLag <= 0 || bestCorr < 0.35) return null;

    const freq = sr / bestLag;
    return isFinite(freq) && freq > 0 ? freq : null;
  }

  function extrapolatePianoMap(rootMidi, minMidi = 24, maxMidi = 108) {
    if (!isFinite(rootMidi)) return [];
    const rows = [];
    for (let midi = minMidi; midi <= maxMidi; midi += 1) {
      const semitones = midi - rootMidi;
      rows.push({
        midi,
        note: midiToName(midi),
        semitones,
        ratio: Math.pow(2, semitones / 12),
      });
    }
    return rows;
  }

  function renderPianoMap(rows, rootMidi) {
    if (!pianoMapEl) return;
    if (!rows.length) {
      pianoMapEl.innerHTML = '<div class="small" style="padding:8px">Aucune extrapolation disponible.</div>';
      return;
    }

    const focusRows = rows.filter((r) => r.midi >= 48 && r.midi <= 84);
    let html = '<table><thead><tr><th>Note</th><th>Pitch</th><th>Ratio</th></tr></thead><tbody>';
    for (const row of focusRows) {
      const cls = row.midi === rootMidi ? "inRange" : "";
      const sign = row.semitones > 0 ? "+" : "";
      html += `<tr class="${cls}"><td>${row.note}</td><td>${sign}${row.semitones} st</td><td>${row.ratio.toFixed(4)}x</td></tr>`;
    }
    html += '</tbody></table>';
    pianoMapEl.innerHTML = html;
  }

  function currentEditorProgramData(snapshot) {
    const imported = snapshot?.importedSample || analysisState?.sample || null;
    return {
      sample: imported,
      rootMidi: Number.isFinite(analysisState?.rootMidi) ? analysisState.rootMidi : null,
      rootHz: Number.isFinite(analysisState?.freq) ? analysisState.freq : null,
      loopStartPct: Number(loopStartEl?.value || 15),
      loopEndPct: Number(loopEndEl?.value || 90),
      sustainPct: Number(sustainEl?.value || 72),
    };
  }

  const renderProgramsPanel = (snapshot) => {
    if (!programListEl) return;
    const programs = snapshot?.programs || [];
    const activeId = snapshot?.activeProgramId;
    const activeProgram = programs.find((x) => x.id === activeId) || null;
    if (programNameEl && activeProgram && document.activeElement !== programNameEl) {
      programNameEl.value = activeProgram.name || "";
    }
    programListEl.innerHTML = "";

    if (!programs.length) {
      programListEl.innerHTML = '<div class="small">Aucune programmation sauvegardée.</div>';
      return;
    }

    for (const prog of programs) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "samplerItem" + (prog.id === activeId ? " active" : "");
      const noteLabel = Number.isFinite(prog.rootMidi) ? midiToName(prog.rootMidi) : "—";
      item.innerHTML = `<span>${prog.name}</span><span class="small">${noteLabel}</span>`;
      item.title = prog.sample?.relativePath || prog.sample?.path || prog.name;
      item.addEventListener("click", () => {
        directory.setActiveProgram(prog.id);
        if (programNameEl) programNameEl.value = prog.name || "";
        if (prog.sample) directory.importSample(prog.sample);
        if (loopStartEl) loopStartEl.value = String(Math.max(0, Math.min(100, +prog.loopStartPct || 15)));
        if (loopEndEl) loopEndEl.value = String(Math.max(0, Math.min(100, +prog.loopEndPct || 90)));
        if (sustainEl) sustainEl.value = String(Math.max(0, Math.min(100, +prog.sustainPct || 72)));
        updateLoopStatus();
      });
      programListEl.appendChild(item);
    }
  };

  function drawWaveform(buffer) {
    if (!waveCanvas) return;
    const ctx = waveCanvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#070b12";
    ctx.fillRect(0, 0, waveCanvas.width, waveCanvas.height);
    if (!buffer) return;

    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / waveCanvas.width));
    const h = waveCanvas.height;
    const mid = h / 2;
    ctx.strokeStyle = "#27e0a3";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < waveCanvas.width; x += 1) {
      const idx = Math.min(data.length - 1, x * step);
      const y = mid + data[idx] * (mid * 0.9);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const startPct = Number(loopStartEl?.value || 15) / 100;
    const endPct = Number(loopEndEl?.value || 90) / 100;
    const sustainPct = Number(sustainEl?.value || 72) / 100;

    ctx.strokeStyle = "rgba(112,167,255,.95)";
    ctx.beginPath();
    ctx.moveTo(startPct * waveCanvas.width, 0);
    ctx.lineTo(startPct * waveCanvas.width, h);
    ctx.moveTo(endPct * waveCanvas.width, 0);
    ctx.lineTo(endPct * waveCanvas.width, h);
    ctx.stroke();

    ctx.strokeStyle = "rgba(39,224,163,.95)";
    ctx.beginPath();
    ctx.moveTo(sustainPct * waveCanvas.width, 0);
    ctx.lineTo(sustainPct * waveCanvas.width, h);
    ctx.stroke();
  }

  async function analyzeImportedSample(sample) {
    if (sample?.path && sample.path === lastAnalyzedPath && analysisState?.buffer) {
      drawWaveform(analysisState.buffer);
      return;
    }
    const token = ++analysisToken;
    analysisState = null;
    if (rootNoteEl) rootNoteEl.textContent = "Analyse...";
    if (rootHzEl) rootHzEl.textContent = "Analyse...";
    renderPianoMap([], null);

    try {
      const buffer = await loadSampleBuffer(sample);
      if (token !== analysisToken) return;
      if (!buffer) throw new Error("decodeAudioData indisponible");
      const freq = detectRootFrequency(buffer);
      const rootMidi = frequencyToMidi(freq || 0);
      analysisState = { sample, buffer, freq, rootMidi };
      lastAnalyzedPath = sample?.path || "";
      drawWaveform(buffer);
      if (!isFinite(rootMidi)) {
        if (rootNoteEl) rootNoteEl.textContent = "Non détectée";
        if (rootHzEl) rootHzEl.textContent = "Signal trop faible";
        renderPianoMap([], null);
        return;
      }

      if (rootNoteEl) rootNoteEl.textContent = `${midiToName(rootMidi)} (MIDI ${rootMidi})`;
      if (rootHzEl) rootHzEl.textContent = `${formatHz(freq)} • cible ${formatHz(midiToFrequency(rootMidi))}`;
      const mapping = extrapolatePianoMap(rootMidi);
      renderPianoMap(mapping, rootMidi);
    } catch (error) {
      if (token !== analysisToken) return;
      if (rootNoteEl) rootNoteEl.textContent = "Erreur";
      if (rootHzEl) rootHzEl.textContent = "Impossible d'analyser";
      renderPianoMap([], null);
      console.warn("[Sampler] analyse root note failed", error);
    }
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
      lastAnalyzedPath = "";
      drawWaveform(null);
      if (rootNoteEl) rootNoteEl.textContent = "—";
      if (rootHzEl) rootHzEl.textContent = "—";
      renderPianoMap([], null);
      return;
    }
    setStatus(`Import prêt: ${imported.relativePath || imported.name} (analyse root note en cours).`);
    if (programNameEl && !String(programNameEl.value || "").trim()) {
      programNameEl.value = sampleSuggestedProgramName(imported);
    }
    analyzeImportedSample(imported);
  }

  function render(snapshot) {
    renderRoots(snapshot);
    renderBrowser(snapshot);
    renderPreview(snapshot);
    renderImported(snapshot);

    // Render program tools/panel (naming + save list) without relying on a global symbol.
    try {
      renderProgramsPanel(snapshot);
    } catch (error) {
      console.warn("[Sampler Touski] program list render fallback", error);
      if (programListEl) {
        const programs = snapshot?.programs || [];
        const activeId = snapshot?.activeProgramId;
        programListEl.innerHTML = "";
        if (!programs.length) {
          programListEl.innerHTML = '<div class="small">Aucune programmation sauvegardée.</div>';
          return;
        }
        for (const prog of programs) {
          const row = document.createElement("div");
          row.className = "samplerItem" + (prog.id === activeId ? " active" : "");
          row.innerHTML = `<span>${prog.name || "Program"}</span><span class="small">fallback</span>`;
          row.addEventListener("click", () => directory.setActiveProgram(prog.id));
          programListEl.appendChild(row);
        }
      }
    }
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

  [loopStartEl, loopEndEl, sustainEl].forEach((control) => {
    control?.addEventListener("input", () => {
      updateLoopStatus();
      drawWaveform(analysisState?.buffer || null);
    });
  });

  saveProgramBtn?.addEventListener("click", () => {
    const snapshot = directory.getSnapshot();
    const name = String(programNameEl?.value || "").trim();
    if (!name) {
      setStatus("Donnez un nom à la programmation Sampler Touski.");
      return;
    }

    const payload = currentEditorProgramData(snapshot);
    if (!payload.sample?.path) {
      setStatus("Importez un sample avant d'enregistrer la programmation.");
      return;
    }

    const result = directory.saveProgram({
      id: snapshot.activeProgramId,
      name,
      ...payload,
    });
    if (!result?.ok) {
      setStatus(`Erreur sauvegarde programmation: ${result?.error || "inconnue"}`);
      return;
    }

    setStatus(`Programmation enregistrée: ${name}`);
    if (typeof renderInstrumentPanel === "function") renderInstrumentPanel();
    if (typeof refreshUI === "function") refreshUI();
    try {
      global.dispatchEvent(new CustomEvent("sampler-programs:changed", { detail: directory.getSnapshot() }));
    } catch (_error) {
      // noop
    }
  });

  programNameEl?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveProgramBtn?.click();
    }
  });

  global.addEventListener("sampler-directory:change", (event) => {
    render(event.detail || directory.getSnapshot());
  });

  updateLoopStatus();
  drawWaveform(null);
  directory.restorePersistedRoots().then(() => render(directory.getSnapshot()));
})(window);
