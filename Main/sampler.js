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
  const posActionEl = document.getElementById("samplerPosAction");
  const loopStartEl = document.getElementById("samplerLoopStart");
  const loopEndEl = document.getElementById("samplerLoopEnd");
  const releasePointEl = document.getElementById("samplerReleasePoint");
  const programNameEl = document.getElementById("samplerProgramName");
  const programSelectEl = document.getElementById("samplerProgramSelect");
  const programSaveBtn = document.getElementById("samplerProgramSave");
  const programLoadBtn = document.getElementById("samplerProgramLoad");
  const programStatusEl = document.getElementById("samplerProgramStatus");

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  let audioCtx = null;
  let analysisToken = 0;
  let analysisState = null;

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

  function setProgramStatus(message) {
    if (programStatusEl) programStatusEl.textContent = message;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function getMarkerPositions() {
    const pos_action = clamp01(Number(posActionEl?.value || 0) / 100);
    const pos_loop_start = clamp01(Number(loopStartEl?.value || 15) / 100);
    const pos_loop_end = clamp01(Number(loopEndEl?.value || 90) / 100);
    const pos_release = clamp01(Number(releasePointEl?.value || 100) / 100);
    return { pos_action, pos_loop_start, pos_loop_end, pos_release };
  }

  function updateLoopStatus() {
    const { pos_action, pos_loop_start, pos_loop_end, pos_release } = getMarkerPositions();
    const action = Math.round(pos_action * 100);
    const start = Math.round(pos_loop_start * 100);
    const end = Math.round(pos_loop_end * 100);
    const release = Math.round(pos_release * 100);
    if (start <= action) {
      setLoopStatus("Zone invalide: Start Loop doit être après Key Action.");
      return;
    }
    if (end <= start + 1) {
      setLoopStatus("Zone invalide: End Loop doit être > Start Loop.");
      return;
    }
    if (release < end) {
      setLoopStatus("Zone invalide: Release Point doit être ≥ End Loop.");
      return;
    }
    setLoopStatus(`Key Action ${action}% → ${start}% • Loop ${start}% ↔ ${end}% • Release jusqu'à ${release}%`);
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

    const { pos_action, pos_loop_start, pos_loop_end, pos_release } = getMarkerPositions();
    const markerDefs = [
      { pct: pos_action, color: "#d04cff" },
      { pct: pos_loop_start, color: "#f5ea2f" },
      { pct: pos_loop_end, color: "#ff4b4b" },
      { pct: pos_release, color: "#36b7ff" },
    ];

    for (const marker of markerDefs) {
      const x = marker.pct * waveCanvas.width;
      ctx.strokeStyle = marker.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }

  async function analyzeImportedSample(sample) {
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
      drawWaveform(null);
      if (rootNoteEl) rootNoteEl.textContent = "—";
      if (rootHzEl) rootHzEl.textContent = "—";
      renderPianoMap([], null);
      return;
    }
    setStatus(`Import prêt: ${imported.relativePath || imported.name} (analyse root note en cours).`);
    analyzeImportedSample(imported);
  }

  function toProgramPayload(sample, sourceProgramId = null) {
    const rootMidiFromUI = Number.parseInt(String(rootNoteEl?.textContent || "").match(/MIDI\s*(-?\d+)/)?.[1] || "", 10);
    const rootHzFromUI = Number.parseFloat(String(rootHzEl?.textContent || "").match(/([\d.]+)\s*Hz/)?.[1] || "");
    const suggestedName = sampleSuggestedProgramName(sample) || "Sampler Program";
    const rawName = String(programNameEl?.value || suggestedName).trim();

    const positions = getMarkerPositions();
    return {
      id: sourceProgramId || undefined,
      name: rawName || suggestedName,
      sample: sample || null,
      rootMidi: Number.isFinite(analysisState?.rootMidi) ? analysisState.rootMidi : (Number.isFinite(rootMidiFromUI) ? rootMidiFromUI : null),
      rootHz: Number.isFinite(analysisState?.freq) ? analysisState.freq : (Number.isFinite(rootHzFromUI) ? rootHzFromUI : null),
      posAction: positions.pos_action,
      posLoopStart: positions.pos_loop_start,
      posLoopEnd: positions.pos_loop_end,
      posRelease: positions.pos_release,
      loopStartPct: Math.round(positions.pos_loop_start * 100),
      loopEndPct: Math.round(positions.pos_loop_end * 100),
      sustainPct: Math.round(positions.pos_loop_end * 100),
    };
  }

  function renderPrograms(snapshot) {
    if (!programSelectEl) return;
    const programs = Array.isArray(snapshot.programs) ? snapshot.programs : [];
    const activeId = snapshot.activeProgramId || null;

    programSelectEl.innerHTML = "";
    if (!programs.length) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "(aucun programme)";
      programSelectEl.appendChild(empty);
      programSelectEl.value = "";
      setProgramStatus("Aucun programme enregistré.");
      return;
    }

    for (const program of programs) {
      const option = document.createElement("option");
      option.value = program.id;
      option.textContent = program.name || "Sampler Program";
      option.title = program.sample?.relativePath || program.sample?.name || "";
      programSelectEl.appendChild(option);
    }

    const selectedId = programs.find((p) => p.id === activeId)?.id || programs[0].id;
    programSelectEl.value = selectedId;

    const activeProgram = programs.find((p) => p.id === selectedId) || null;
    if (activeProgram && programNameEl && document.activeElement !== programNameEl) {
      programNameEl.value = activeProgram.name || sampleSuggestedProgramName(activeProgram.sample) || "";
    }
    if (activeProgram) {
      const sampleName = activeProgram.sample?.relativePath || activeProgram.sample?.name || "sample non défini";
      setProgramStatus(`Programme actif: ${activeProgram.name || "Sampler Program"} • ${sampleName}`);
    }
  }

  function render(snapshot) {
    renderRoots(snapshot);
    renderBrowser(snapshot);
    renderPreview(snapshot);
    renderImported(snapshot);
    renderPrograms(snapshot);
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

  [posActionEl, loopStartEl, loopEndEl, releasePointEl].forEach((control) => {
    control?.addEventListener("input", () => {
      updateLoopStatus();
      drawWaveform(analysisState?.buffer || null);
    });
  });

  programSelectEl?.addEventListener("change", () => {
    const id = programSelectEl.value;
    directory.setActiveProgram(id || null);
  });

  programSaveBtn?.addEventListener("click", () => {
    const imported = directory.state.importedSample;
    if (!imported) {
      setProgramStatus("Importez d'abord un sample avant d'enregistrer un programme.");
      return;
    }

    const currentProgramId = programSelectEl?.value || null;
    const payload = toProgramPayload(imported, currentProgramId || null);
    const result = directory.saveProgram(payload);
    if (!result?.ok) {
      setProgramStatus(`Erreur sauvegarde programme: ${result?.error || "inconnue"}`);
      return;
    }
    setProgramStatus(`Programme sauvegardé: ${result.program.name}`);
    global.dispatchEvent(new CustomEvent("sampler-programs:changed", { detail: result.program }));
  });

  programLoadBtn?.addEventListener("click", () => {
    const programId = programSelectEl?.value || directory.state.activeProgramId;
    const program = directory.getProgram(programId);
    if (!program) {
      setProgramStatus("Sélectionnez un programme à charger.");
      return;
    }

    if (program.sample) directory.importSample(program.sample);
    const posAction = Number.isFinite(+program.posAction) ? +program.posAction : 0;
    const posLoopStart = Number.isFinite(+program.posLoopStart) ? +program.posLoopStart : ((Number(program.loopStartPct) || 15) / 100);
    const posLoopEnd = Number.isFinite(+program.posLoopEnd) ? +program.posLoopEnd : ((Number(program.loopEndPct) || 90) / 100);
    const posRelease = Number.isFinite(+program.posRelease) ? +program.posRelease : 1;
    if (posActionEl) posActionEl.value = String(Math.round(100 * clamp01(posAction)));
    if (loopStartEl) loopStartEl.value = String(Math.round(100 * clamp01(posLoopStart)));
    if (loopEndEl) loopEndEl.value = String(Math.round(100 * clamp01(posLoopEnd)));
    if (releasePointEl) releasePointEl.value = String(Math.round(100 * clamp01(posRelease)));
    if (programNameEl) programNameEl.value = program.name || "";
    directory.setActiveProgram(program.id);
    updateLoopStatus();
    drawWaveform(analysisState?.buffer || null);
    setProgramStatus(`Programme chargé: ${program.name}`);
    global.dispatchEvent(new CustomEvent("sampler-programs:changed", { detail: program }));
  });

  global.addEventListener("sampler-directory:change", (event) => {
    render(event.detail || directory.getSnapshot());
  });

  updateLoopStatus();
  drawWaveform(null);
  directory.restorePersistedRoots().then(() => render(directory.getSnapshot()));
})(window);
