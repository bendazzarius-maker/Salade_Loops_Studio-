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
  const modeActionBtn = document.getElementById("samplerModeAction");
  const modeLoopStartBtn = document.getElementById("samplerModeLoopStart");
  const modeLoopEndBtn = document.getElementById("samplerModeLoopEnd");
  const modeReleaseBtn = document.getElementById("samplerModeRelease");
  const wizardLoopBtn = document.getElementById("samplerWizardLoop");
  const programNameEl = document.getElementById("samplerProgramName");
  const programCategoryEl = document.getElementById("samplerProgramCategory");
  const programNewCategoryEl = document.getElementById("samplerProgramNewCategory");
  const programCreateCategoryBtn = document.getElementById("samplerProgramCreateCategory");
  const programSelectEl = document.getElementById("samplerProgramSelect");
  const programUpdateBtn = document.getElementById("samplerProgramUpdate");
  const programSaveAsBtn = document.getElementById("samplerProgramSaveAs");
  const programLoadBtn = document.getElementById("samplerProgramLoad");
  const programStatusEl = document.getElementById("samplerProgramStatus");
  const previewPlayBtn = document.getElementById("samplerPreviewPlay");
  const programTreeEl = document.getElementById("samplerProgramTree");

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  let audioCtx = null;
  let previewSession = null;
  let analysisToken = 0;
  let analysisState = null;
  const markerState = {
    pos_action: 0,
    pos_loop_start: 0.15,
    pos_loop_end: 0.9,
    pos_release: 1,
  };
  const viewState = {
    start: 0,
    end: 1,
    ampZoom: 1,
    mode: "pos_action",
    draggingMarker: null,
    isPanning: false,
    panAnchorX: 0,
    panStartView: 0,
  };

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
    return { ...markerState };
  }

  function setMarkerPositions(next = {}) {
    if (Number.isFinite(+next.pos_action)) markerState.pos_action = clamp01(+next.pos_action);
    if (Number.isFinite(+next.pos_loop_start)) markerState.pos_loop_start = clamp01(+next.pos_loop_start);
    if (Number.isFinite(+next.pos_loop_end)) markerState.pos_loop_end = clamp01(+next.pos_loop_end);
    if (Number.isFinite(+next.pos_release)) markerState.pos_release = clamp01(+next.pos_release);

    markerState.pos_loop_start = Math.max(markerState.pos_action + 0.001, markerState.pos_loop_start);
    markerState.pos_loop_end = Math.max(markerState.pos_loop_start + 0.001, markerState.pos_loop_end);
    markerState.pos_release = Math.max(markerState.pos_loop_end, markerState.pos_release);

    markerState.pos_action = clamp01(markerState.pos_action);
    markerState.pos_loop_start = clamp01(markerState.pos_loop_start);
    markerState.pos_loop_end = clamp01(markerState.pos_loop_end);
    markerState.pos_release = clamp01(markerState.pos_release);
  }

  function setEditMode(mode) {
    viewState.mode = mode;
    const pairs = [
      [modeActionBtn, "pos_action"],
      [modeLoopStartBtn, "pos_loop_start"],
      [modeLoopEndBtn, "pos_loop_end"],
      [modeReleaseBtn, "pos_release"],
    ];
    for (const [btn, markerKey] of pairs) btn?.classList.toggle("active", markerKey === mode);
  }

  function updateLoopStatus() {
    const { pos_action, pos_loop_start, pos_loop_end, pos_release } = getMarkerPositions();
    const action = Math.round(pos_action * 100);
    const start = Math.round(pos_loop_start * 100);
    const end = Math.round(pos_loop_end * 100);
    const release = Math.round(pos_release * 100);
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

  function stopPreviewSession() {
    if (!previewSession) return;
    const now = ensureAudioContext()?.currentTime || 0;
    const fade = 0.015;
    const elapsedSampleSec = Math.max(0, now - previewSession.startedAt);
    let releaseStartSec = previewSession.actionSec + elapsedSampleSec;
    if (releaseStartSec >= previewSession.loopStartSec) {
      const loopElapsed = (releaseStartSec - previewSession.loopStartSec) % previewSession.loopLenSec;
      releaseStartSec = previewSession.loopStartSec + loopElapsed;
    }
    releaseStartSec = Math.min(Math.max(previewSession.actionSec, releaseStartSec), previewSession.releaseSec);
    const tailSec = Math.max(0.02, previewSession.releaseSec - releaseStartSec);
    try {
      previewSession.sustainGate?.gain.cancelScheduledValues(now);
      previewSession.sustainGate?.gain.setValueAtTime(previewSession.sustainGate.gain.value || 1, now);
      previewSession.sustainGate?.gain.linearRampToValueAtTime(0.0001, now + fade);
      previewSession.releaseGate?.gain.cancelScheduledValues(now);
      previewSession.releaseGate?.gain.setValueAtTime(previewSession.releaseGate.gain.value || 0.0001, now);
      previewSession.releaseGate?.gain.linearRampToValueAtTime(1, now + fade);
      previewSession.master?.gain.cancelScheduledValues(now);
      previewSession.master?.gain.setValueAtTime(previewSession.master.gain.value || 0.95, now);
      previewSession.master?.gain.linearRampToValueAtTime(0.0001, now + tailSec + 0.08);
    } catch (_error) {}
    try { previewSession.sustainSrc?.stop(now + fade + 0.05); } catch (_error) {}
    try { previewSession.releaseSrc?.start(now, releaseStartSec); } catch (_error) {}
    try { previewSession.releaseSrc?.stop(now + tailSec + 0.08); } catch (_error) {}
    previewSession = null;
  }

  function startPreviewSession() {
    const imported = directory.state.importedSample;
    if (!imported) {
      setLoopStatus("Preview Play: importez un sample d'abord.");
      return;
    }
    if (!Number.isFinite(analysisState?.rootMidi)) {
      setLoopStatus("Preview Play: root note analysée requise.");
      return;
    }
    const buffer = analysisState?.buffer;
    const ctx = ensureAudioContext();
    if (!buffer || !ctx) return;

    stopPreviewSession();
    const positions = getMarkerPositions();
    const actionSec = positions.pos_action * buffer.duration;
    const loopStartSec = positions.pos_loop_start * buffer.duration;
    const loopEndSec = positions.pos_loop_end * buffer.duration;
    const releaseSec = positions.pos_release * buffer.duration;
    const loopLenSec = Math.max(0.001, loopEndSec - loopStartSec);
    const now = ctx.currentTime;

    const master = ctx.createGain();
    const sustainGate = ctx.createGain();
    const releaseGate = ctx.createGain();
    master.connect(ctx.destination);
    sustainGate.connect(master);
    releaseGate.connect(master);
    master.gain.setValueAtTime(0.95, now);
    sustainGate.gain.setValueAtTime(1, now);
    releaseGate.gain.setValueAtTime(0.0001, now);

    const sustainSrc = ctx.createBufferSource();
    sustainSrc.buffer = buffer;
    sustainSrc.playbackRate.setValueAtTime(1, now);
    sustainSrc.loop = true;
    sustainSrc.loopStart = loopStartSec;
    sustainSrc.loopEnd = loopEndSec;
    sustainSrc.connect(sustainGate);
    sustainSrc.start(now, actionSec);

    const releaseSrc = ctx.createBufferSource();
    releaseSrc.buffer = buffer;
    releaseSrc.playbackRate.setValueAtTime(1, now);
    releaseSrc.connect(releaseGate);

    previewSession = {
      startedAt: now,
      actionSec,
      loopStartSec,
      loopLenSec,
      releaseSec,
      master,
      sustainGate,
      releaseGate,
      sustainSrc,
      releaseSrc,
    };
    setLoopStatus("Preview Play: action → loop (maintenu), relâchez pour la phase release.");
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
      rows.push({ midi, note: midiToName(midi), semitones, ratio: Math.pow(2, semitones / 12) });
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
    html += "</tbody></table>";
    pianoMapEl.innerHTML = html;
  }

  function normalizeInView(normPos) {
    return (normPos - viewState.start) / Math.max(1e-6, (viewState.end - viewState.start));
  }

  function canvasXToNorm(x) {
    const ratio = clamp01(x / waveCanvas.width);
    return viewState.start + ratio * (viewState.end - viewState.start);
  }

  function nearestZeroCrossing(data, sampleIndex, radius = 256) {
    let best = Math.max(1, Math.min(data.length - 2, sampleIndex));
    let bestScore = Infinity;
    const from = Math.max(1, best - radius);
    const to = Math.min(data.length - 2, best + radius);
    for (let i = from; i <= to; i += 1) {
      const a = data[i - 1];
      const b = data[i];
      const crossing = (a <= 0 && b >= 0) || (a >= 0 && b <= 0);
      if (!crossing) continue;
      const score = Math.abs(i - sampleIndex);
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    }
    return best;
  }

  function drawWaveform(buffer) {
    if (!waveCanvas) return;
    const ctx = waveCanvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#070b12";
    ctx.fillRect(0, 0, waveCanvas.width, waveCanvas.height);
    if (!buffer) return;

    const data = buffer.getChannelData(0);
    const h = waveCanvas.height;
    const mid = h / 2;
    const start = Math.floor(viewState.start * (data.length - 1));
    const end = Math.max(start + 2, Math.floor(viewState.end * (data.length - 1)));
    const range = end - start;

    ctx.strokeStyle = "#27e0a3";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < waveCanvas.width; x += 1) {
      const idx = Math.min(data.length - 1, start + Math.floor((x / waveCanvas.width) * range));
      const y = mid + data[idx] * (mid * 0.9 * viewState.ampZoom);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const markerDefs = [
      { key: "pos_action", color: "#d04cff" },
      { key: "pos_loop_start", color: "#f5ea2f" },
      { key: "pos_loop_end", color: "#ff4b4b" },
      { key: "pos_release", color: "#36b7ff" },
    ];

    for (const marker of markerDefs) {
      const inView = normalizeInView(markerState[marker.key]);
      if (inView < 0 || inView > 1) continue;
      const x = inView * waveCanvas.width;
      ctx.strokeStyle = marker.color;
      ctx.lineWidth = viewState.draggingMarker === marker.key ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "11px sans-serif";
    ctx.fillText(`Zoom X ${(1 / (viewState.end - viewState.start)).toFixed(2)}x | Zoom Y ${viewState.ampZoom.toFixed(2)}x`, 10, 16);
  }

  function placeMarkerFromCanvasX(x) {
    if (!analysisState?.buffer || !waveCanvas) return;
    const data = analysisState.buffer.getChannelData(0);
    const raw = canvasXToNorm(x);
    const sampleIndex = Math.floor(clamp01(raw) * (data.length - 1));
    const snapped = nearestZeroCrossing(data, sampleIndex);
    const snappedNorm = snapped / Math.max(1, data.length - 1);
    setMarkerPositions({ [viewState.mode]: snappedNorm });
    updateLoopStatus();
    drawWaveform(analysisState.buffer);
  }


  function eventToCanvasX(event) {
    if (!waveCanvas) return 0;
    const rect = waveCanvas.getBoundingClientRect();
    if (!rect.width) return 0;
    const ratio = (event.clientX - rect.left) / rect.width;
    return clamp01(ratio) * waveCanvas.width;
  }

  function markerFromCanvasX(x, thresholdPx = 9) {
    const candidates = ["pos_action", "pos_loop_start", "pos_loop_end", "pos_release"];
    for (const key of candidates) {
      const markerX = normalizeInView(markerState[key]) * waveCanvas.width;
      if (Math.abs(markerX - x) <= thresholdPx) return key;
    }
    return null;
  }

  function installWaveInteractions() {
    if (!waveCanvas) return;

    waveCanvas.addEventListener("wheel", (event) => {
      if (!analysisState?.buffer) return;
      event.preventDefault();
      const direction = event.deltaY > 0 ? 1 : -1;

      if (event.shiftKey) {
        const nextAmp = viewState.ampZoom * (direction > 0 ? 0.9 : 1.1);
        viewState.ampZoom = Math.max(0.35, Math.min(8, nextAmp));
      } else {
        const pivot = canvasXToNorm(eventToCanvasX(event));
        const currentRange = viewState.end - viewState.start;
        const nextRange = Math.max(0.01, Math.min(1, currentRange * (direction > 0 ? 1.08 : 0.92)));
        const anchor = clamp01((pivot - viewState.start) / currentRange);
        let nextStart = pivot - anchor * nextRange;
        nextStart = Math.max(0, Math.min(1 - nextRange, nextStart));
        viewState.start = nextStart;
        viewState.end = nextStart + nextRange;
      }
      drawWaveform(analysisState.buffer);
    }, { passive: false });

    waveCanvas.addEventListener("mousedown", (event) => {
      if (!analysisState?.buffer) return;
      if (event.button === 1) {
        event.preventDefault();
        viewState.isPanning = true;
        viewState.panAnchorX = event.clientX;
        viewState.panStartView = viewState.start;
        return;
      }
      if (event.button !== 0) return;

      const clickX = eventToCanvasX(event);
      const marker = markerFromCanvasX(clickX);
      if (marker) {
        viewState.draggingMarker = marker;
        drawWaveform(analysisState.buffer);
        return;
      }
      placeMarkerFromCanvasX(clickX);
    });

    waveCanvas.addEventListener("mousemove", (event) => {
      if (!analysisState?.buffer) return;
      if (viewState.isPanning) {
        const range = viewState.end - viewState.start;
        if (range >= 0.999) return;
        const rect = waveCanvas.getBoundingClientRect();
        const deltaNorm = (event.clientX - viewState.panAnchorX) / Math.max(1, rect.width);
        let nextStart = viewState.panStartView - deltaNorm * range;
        nextStart = Math.max(0, Math.min(1 - range, nextStart));
        viewState.start = nextStart;
        viewState.end = nextStart + range;
        drawWaveform(analysisState.buffer);
        return;
      }
      if (!viewState.draggingMarker) return;
      const data = analysisState.buffer.getChannelData(0);
      const raw = canvasXToNorm(eventToCanvasX(event));
      const idx = Math.floor(clamp01(raw) * (data.length - 1));
      const snapped = nearestZeroCrossing(data, idx);
      setMarkerPositions({ [viewState.draggingMarker]: snapped / Math.max(1, data.length - 1) });
      updateLoopStatus();
      drawWaveform(analysisState.buffer);
    });

    const releaseDrag = () => {
      if (!analysisState?.buffer) return;
      viewState.draggingMarker = null;
      viewState.isPanning = false;
      drawWaveform(analysisState.buffer);
    };

    waveCanvas.addEventListener("mouseup", releaseDrag);
    waveCanvas.addEventListener("mouseleave", releaseDrag);
  }

  function normalizedAutoCorrelation(data, startA, startB, size) {
    let corr = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < size; i += 1) {
      const a = data[startA + i] || 0;
      const b = data[startB + i] || 0;
      corr += a * b;
      normA += a * a;
      normB += b * b;
    }
    return corr / (Math.sqrt(normA * normB) || 1);
  }

  function estimateCycleLength(data, sampleRate, index) {
    const minLag = Math.max(8, Math.floor(sampleRate / 1800));
    const maxLag = Math.min(Math.floor(sampleRate / 30), 4096);
    const start = Math.max(0, index - 4096);
    const win = data.subarray(start, Math.min(data.length, start + 8192));
    let bestLag = 0;
    let bestScore = -1;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let corr = 0;
      let normA = 0;
      let normB = 0;
      const end = win.length - lag;
      if (end <= 128) continue;
      for (let i = 0; i < end; i += 1) {
        const a = win[i];
        const b = win[i + lag];
        corr += a * b;
        normA += a * a;
        normB += b * b;
      }
      const score = corr / (Math.sqrt(normA * normB) || 1);
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    return bestLag > 0 ? bestLag : Math.max(32, Math.floor(sampleRate / 220));
  }

  function findPerfectLoop(startZone, endZone) {
    if (!analysisState?.buffer) return null;
    const buffer = analysisState.buffer;
    const data = buffer.getChannelData(0);
    const sr = buffer.sampleRate || 44100;

    const startFrom = Math.floor(clamp01(startZone.start) * (data.length - 1));
    const startTo = Math.floor(clamp01(startZone.end) * (data.length - 1));
    const endFrom = Math.floor(clamp01(endZone.start) * (data.length - 1));
    const endTo = Math.floor(clamp01(endZone.end) * (data.length - 1));

    const startCrossings = [];
    const endCrossings = [];
    for (let i = Math.max(1, startFrom); i < Math.min(data.length - 1, startTo); i += 1) {
      if ((data[i - 1] <= 0 && data[i] >= 0) || (data[i - 1] >= 0 && data[i] <= 0)) startCrossings.push(i);
    }
    for (let i = Math.max(1, endFrom); i < Math.min(data.length - 1, endTo); i += 1) {
      if ((data[i - 1] <= 0 && data[i] >= 0) || (data[i - 1] >= 0 && data[i] <= 0)) endCrossings.push(i);
    }
    if (!startCrossings.length || !endCrossings.length) return null;

    const cycle = estimateCycleLength(data, sr, startCrossings[0]);
    const window = Math.max(128, Math.min(1024, Math.floor(cycle * 2.5)));

    let best = null;
    const stepStart = Math.max(1, Math.floor(startCrossings.length / 120));
    const stepEnd = Math.max(1, Math.floor(endCrossings.length / 120));

    for (let si = 0; si < startCrossings.length; si += stepStart) {
      const s = startCrossings[si];
      const ampS = Math.abs(data[s]);
      for (let ei = 0; ei < endCrossings.length; ei += stepEnd) {
        const e = endCrossings[ei];
        if (e <= s + window) continue;

        const cycleCount = (e - s) / cycle;
        const nearestEven = Math.max(2, Math.round(cycleCount / 2) * 2);
        const cycleError = Math.abs(cycleCount - nearestEven);
        if (cycleError > 0.75) continue;

        const ampE = Math.abs(data[e]);
        const ampDiff = Math.abs(ampS - ampE);
        const corrStart = Math.max(0, Math.min(data.length - window - 1, s - Math.floor(window / 2)));
        const corrEnd = Math.max(0, Math.min(data.length - window - 1, e - Math.floor(window / 2)));
        const corr = normalizedAutoCorrelation(data, corrStart, corrEnd, window);
        const score = corr - (ampDiff * 2.5) - (cycleError * 0.2);

        if (!best || score > best.score) best = { start: s, end: e, score, corr, ampDiff, cycleError };
      }
    }

    if (!best) return null;
    return {
      pos_loop_start: best.start / Math.max(1, data.length - 1),
      pos_loop_end: best.end / Math.max(1, data.length - 1),
    };
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
      viewState.start = 0;
      viewState.end = 1;
      viewState.ampZoom = 1;
      drawWaveform(buffer);
      if (!isFinite(rootMidi)) {
        if (rootNoteEl) rootNoteEl.textContent = "Non détectée";
        if (rootHzEl) rootHzEl.textContent = "Signal trop faible";
        renderPianoMap([], null);
        return;
      }

      if (rootNoteEl) rootNoteEl.textContent = `${midiToName(rootMidi)} (MIDI ${rootMidi})`;
      if (rootHzEl) rootHzEl.textContent = `${formatHz(freq)} • cible ${formatHz(midiToFrequency(rootMidi))}`;
      renderPianoMap(extrapolatePianoMap(rootMidi), rootMidi);
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
      item.addEventListener("click", () => directory.selectSample(sample));
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

  function toProgramPayload(sample, sourceProgram = null, mode = "saveAs") {
    const rootMidiFromUI = Number.parseInt(String(rootNoteEl?.textContent || "").match(/MIDI\s*(-?\d+)/)?.[1] || "", 10);
    const rootHzFromUI = Number.parseFloat(String(rootHzEl?.textContent || "").match(/([\d.]+)\s*Hz/)?.[1] || "");
    const suggestedName = sampleSuggestedProgramName(sample) || "Sampler Program";
    const rawName = String(programNameEl?.value || suggestedName).trim();
    const positions = getMarkerPositions();

    return {
      id: mode === "update" ? (sourceProgram?.id || undefined) : undefined,
      filePath: sourceProgram?.filePath || null,
      relativeFilePath: sourceProgram?.relativeFilePath || null,
      category: programCategoryEl?.value || sourceProgram?.category || "",
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


  function renderCategories(snapshot) {
    if (!programCategoryEl) return;
    const categories = Array.isArray(snapshot.categories) ? snapshot.categories : [""];
    const selected = snapshot.activeCategory || "";
    programCategoryEl.innerHTML = "";
    for (const cat of categories) {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat || "(racine)";
      programCategoryEl.appendChild(opt);
    }
    if (!categories.includes(selected)) {
      const extra = document.createElement("option");
      extra.value = selected;
      extra.textContent = selected || "(racine)";
      programCategoryEl.appendChild(extra);
    }
    programCategoryEl.value = selected;
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
      const where = activeProgram.relativeFilePath || activeProgram.category || "(racine)";
      if (programCategoryEl && activeProgram.category != null) programCategoryEl.value = activeProgram.category || "";
      setProgramStatus(`Programme actif: ${activeProgram.name || "Sampler Program"} • ${sampleName} • ${where}`);
    }
  }

  function buildProgramTree(snapshot) {
    const tree = { __path: "", __children: new Map(), __count: 0 };
    for (const program of (snapshot.programs || [])) {
      const category = String(program.category || "").trim();
      const parts = category ? category.split("/").filter(Boolean) : [];
      let cursor = tree;
      for (const part of parts) {
        if (!cursor.__children.has(part)) cursor.__children.set(part, { __path: cursor.__path ? `${cursor.__path}/${part}` : part, __children: new Map(), __count: 0 });
        cursor = cursor.__children.get(part);
      }
      cursor.__count += 1;
    }
    return tree;
  }

  function renderProgramTree(snapshot) {
    if (!programTreeEl) return;
    const tree = buildProgramTree(snapshot);
    programTreeEl.innerHTML = "";

    const makeNode = (label, relativeDir, depth, count) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "samplerTreeNode" + ((snapshot.activeCategory || "") === relativeDir ? " active" : "");
      btn.style.paddingLeft = `${8 + depth * 16}px`;
      btn.innerHTML = `<span>${label}</span><span class="small">${count}</span>`;
      btn.addEventListener("click", () => {
        directory.setActiveCategory(relativeDir);
        if (programCategoryEl) programCategoryEl.value = relativeDir;
      });
      return btn;
    };

    const rootCount = (snapshot.programs || []).filter((p) => !(p.category || "")).length;
    programTreeEl.appendChild(makeNode("(racine)", "", 0, rootCount));

    function walk(node, depth = 0) {
      const entries = Array.from(node.__children.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      for (const [name, child] of entries) {
        let total = child.__count;
        const stack = [child];
        while (stack.length) {
          const x = stack.pop();
          for (const sub of x.__children.values()) {
            total += sub.__count;
            stack.push(sub);
          }
        }
        programTreeEl.appendChild(makeNode(name, child.__path, depth + 1, total));
        walk(child, depth + 1);
      }
    }
    walk(tree);
  }

  function render(snapshot) {
    renderRoots(snapshot);
    renderBrowser(snapshot);
    renderPreview(snapshot);
    renderImported(snapshot);
    renderCategories(snapshot);
    renderPrograms(snapshot);
    renderProgramTree(snapshot);
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
      if (!result?.ok && !result?.canceled) setStatus(`Erreur ajout dossier: ${result?.error || "inconnue"}`);
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

  dropZoneEl?.addEventListener("dragleave", () => dropZoneEl.classList.remove("dragover"));

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

  modeActionBtn?.addEventListener("click", () => setEditMode("pos_action"));
  modeLoopStartBtn?.addEventListener("click", () => setEditMode("pos_loop_start"));
  modeLoopEndBtn?.addEventListener("click", () => setEditMode("pos_loop_end"));
  modeReleaseBtn?.addEventListener("click", () => setEditMode("pos_release"));

  wizardLoopBtn?.addEventListener("click", () => {
    if (!analysisState?.buffer) {
      setLoopStatus("Importez un sample pour utiliser Wizard Loop.");
      return;
    }
    const found = findPerfectLoop(
      { start: markerState.pos_loop_start, end: Math.min(1, markerState.pos_loop_start + 0.2) },
      { start: Math.max(markerState.pos_loop_start + 0.02, markerState.pos_loop_end - 0.2), end: markerState.pos_release }
    );
    if (!found) {
      setLoopStatus("Wizard Loop: aucune boucle idéale trouvée dans les zones sélectionnées.");
      return;
    }
    setMarkerPositions(found);
    updateLoopStatus();
    drawWaveform(analysisState.buffer);
    setLoopStatus(`${loopStatusEl.textContent} • Wizard: zéro crossing + corrélation OK.`);
  });

  programSelectEl?.addEventListener("change", () => {
    const id = programSelectEl.value;
    directory.setActiveProgram(id || null);
  });

  async function saveProgramWithMode(mode) {
    const imported = directory.state.importedSample;
    if (!imported) {
      setProgramStatus("Importez d'abord un sample avant d'enregistrer un programme.");
      return;
    }

    const current = directory.getProgram(programSelectEl?.value || null);
    const payload = toProgramPayload(imported, current, mode);
    const opts = {
      mode,
      relativeDir: programCategoryEl?.value || "",
      targetFilePath: mode === "update" ? current?.filePath : null,
    };
    const result = await directory.saveProgram(payload, opts);
    if (!result?.ok) {
      setProgramStatus(`Erreur sauvegarde programme: ${result?.error || "inconnue"}`);
      return;
    }
    setProgramStatus(`Programme sauvegardé: ${result.program?.name || payload.name}`);
    global.dispatchEvent(new CustomEvent("sampler-programs:changed", { detail: result.program || payload }));
  }

  programUpdateBtn?.addEventListener("click", () => saveProgramWithMode("update"));
  programSaveAsBtn?.addEventListener("click", () => saveProgramWithMode("saveAs"));


  programCategoryEl?.addEventListener("change", () => {
    directory.setActiveCategory(programCategoryEl.value || "");
  });

  programCreateCategoryBtn?.addEventListener("click", async () => {
    const value = String(programNewCategoryEl?.value || "").trim();
    if (!value) {
      setProgramStatus("Entrez un nom de sous-dossier.");
      return;
    }
    const base = String(programCategoryEl?.value || "").trim().replace(/^\/+|\/+$/g, "");
    const relative = value.includes("/") ? value : (base ? `${base}/${value}` : value);
    const result = await directory.createCategory(relative);
    if (!result?.ok) {
      setProgramStatus(`Erreur création dossier: ${result?.error || "inconnue"}`);
      return;
    }
    if (programNewCategoryEl) programNewCategoryEl.value = "";
    setProgramStatus(`Catégorie prête: ${result.relativeDir || "(racine)"}`);
  });

  programLoadBtn?.addEventListener("click", () => {
    const programId = programSelectEl?.value || directory.state.activeProgramId;
    const program = directory.getProgram(programId);
    if (!program) {
      setProgramStatus("Sélectionnez un programme à charger.");
      return;
    }

    if (program.sample) directory.importSample(program.sample);
    setMarkerPositions({
      pos_action: Number.isFinite(+program.posAction) ? +program.posAction : 0,
      pos_loop_start: Number.isFinite(+program.posLoopStart) ? +program.posLoopStart : ((Number(program.loopStartPct) || 15) / 100),
      pos_loop_end: Number.isFinite(+program.posLoopEnd) ? +program.posLoopEnd : ((Number(program.loopEndPct) || 90) / 100),
      pos_release: Number.isFinite(+program.posRelease) ? +program.posRelease : 1,
    });
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

  previewPlayBtn?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    startPreviewSession();
  });
  const releasePreview = () => stopPreviewSession();
  previewPlayBtn?.addEventListener("pointerup", releasePreview);
  previewPlayBtn?.addEventListener("pointerleave", releasePreview);
  previewPlayBtn?.addEventListener("pointercancel", releasePreview);

  setEditMode("pos_action");
  installWaveInteractions();
  updateLoopStatus();
  drawWaveform(null);
  directory.restorePersistedRoots().then(() => render(directory.getSnapshot()));
})(window);
