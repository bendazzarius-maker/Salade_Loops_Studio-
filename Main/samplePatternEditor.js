/* ================= Electro DAW | samplePatternEditor.js ================= */
(function initSamplePatternEditor(global) {
  const host = document.getElementById("samplePatternEditor");
  if (!host) return;

  const startEl = document.getElementById("samplePatternStart");
  const endEl = document.getElementById("samplePatternEnd");
  const beatsEl = document.getElementById("samplePatternBeats");
  const rootMidiEl = document.getElementById("samplePatternRootMidi");
  const pitchModeEl = document.getElementById("samplePatternPitchMode");
  const gainEl = document.getElementById("samplePatternGain");
  const mixOutEl = document.getElementById("samplePatternMixOut");
  const nameEl = document.getElementById("samplePatternName");
  const saveBtn = document.getElementById("samplePatternSavePattern");
  const previewBtn = document.getElementById("samplePatternPreviewHold");
  const statusEl = document.getElementById("samplePatternStatus");
  const canvas = document.getElementById("samplePatternWave");

  const editor = {
    samplePath: "",
    buffer: null,
    posStart: 0,
    posEnd: 1,
    zoomStart: 0,
    zoomEnd: 1,
    ampZoom: 1,
    dragging: null,
    isPanning: false,
    panAnchorX: 0,
    panStartView: 0,
  };

  const previewState = {
    ctx: null,
    source: null,
    gain: null,
    active: false,
  };

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0));
  }

  function normToX(norm) {
    return ((norm - editor.zoomStart) / Math.max(1e-6, editor.zoomEnd - editor.zoomStart)) * canvas.width;
  }

  function xToNorm(x) {
    const ratio = clamp01(x / Math.max(1, canvas.width));
    return editor.zoomStart + ratio * (editor.zoomEnd - editor.zoomStart);
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

  function eventToCanvasX(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return 0;
    return clamp01((event.clientX - rect.left) / rect.width) * canvas.width;
  }

  function markerFromX(x) {
    const sx = normToX(editor.posStart);
    const ex = normToX(editor.posEnd);
    if (Math.abs(sx - x) <= 10) return "start";
    if (Math.abs(ex - x) <= 10) return "end";
    return null;
  }

  async function decodePath(path) {
    if (!path) return null;
    const Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) return null;
    const ac = new Ctor();
    try {
      const response = await fetch(`file://${encodeURI(path.replace(/\\/g, "/"))}`);
      const raw = await response.arrayBuffer();
      const buffer = await ac.decodeAudioData(raw.slice(0));
      return buffer;
    } finally {
      try { await ac.close(); } catch (_) {}
    }
  }

  function drawWaveform() {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#070b12";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const buffer = editor.buffer;
    if (!buffer) {
      ctx.fillStyle = "#9fb4d9";
      ctx.font = "12px sans-serif";
      ctx.fillText("Drag & drop un sample ici", 12, 18);
      return;
    }

    const data = buffer.getChannelData(0);
    const h = canvas.height;
    const mid = h / 2;
    const start = Math.floor(editor.zoomStart * (data.length - 1));
    const end = Math.max(start + 2, Math.floor(editor.zoomEnd * (data.length - 1)));
    const range = end - start;

    ctx.strokeStyle = "#70a7ff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < canvas.width; x += 1) {
      const idx = Math.min(data.length - 1, start + Math.floor((x / canvas.width) * range));
      const y = mid + data[idx] * (mid * 0.9 * editor.ampZoom);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const xStart = normToX(editor.posStart);
    const xEnd = normToX(editor.posEnd);
    const from = Math.max(0, Math.min(xStart, xEnd));
    const width = Math.max(1, Math.abs(xEnd - xStart));

    ctx.fillStyle = "rgba(39,224,163,.16)";
    ctx.fillRect(from, 0, width, h);

    ctx.strokeStyle = "#27e0a3";
    ctx.lineWidth = editor.dragging === "start" ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(xStart, 0);
    ctx.lineTo(xStart, h);
    ctx.stroke();

    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = editor.dragging === "end" ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(xEnd, 0);
    ctx.lineTo(xEnd, h);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.font = "11px sans-serif";
    ctx.fillText(`Zoom X ${(1 / Math.max(0.0001, editor.zoomEnd - editor.zoomStart)).toFixed(2)}x | Zoom Y ${editor.ampZoom.toFixed(2)}x`, 10, 15);
  }

  function placeMarkerAt(x, key) {
    if (!editor.buffer) return;
    const data = editor.buffer.getChannelData(0);
    const norm = clamp01(xToNorm(x));
    const idx = Math.floor(norm * (data.length - 1));
    const snapped = nearestZeroCrossing(data, idx) / Math.max(1, data.length - 1);
    if (key === "start") editor.posStart = Math.min(0.999, snapped);
    if (key === "end") editor.posEnd = Math.max(0.001, snapped);
    if (editor.posStart >= editor.posEnd) {
      if (key === "start") editor.posEnd = Math.min(1, editor.posStart + 0.001);
      else editor.posStart = Math.max(0, editor.posEnd - 0.001);
    }
    startEl.value = String(Math.round(editor.posStart * 1000) / 1000);
    endEl.value = String(Math.round(editor.posEnd * 1000) / 1000);
    drawWaveform();
  }

  function installInteractions() {
    canvas.addEventListener("dragover", (event) => {
      event.preventDefault();
      canvas.style.outline = "2px dashed rgba(39,224,163,.6)";
    });

    canvas.addEventListener("dragleave", () => {
      canvas.style.outline = "none";
    });

    canvas.addEventListener("drop", async (event) => {
      event.preventDefault();
      canvas.style.outline = "none";
      let path = global.sampleDirectory?.state?.dragSample?.path || "";
      if (!path) {
        const dropped = event.dataTransfer?.getData("text/plain") || "";
        path = dropped;
      }
      if (!path) {
        setStatus("Aucun sample détecté au drop.");
        return;
      }
      editor.samplePath = path;
      editor.buffer = await decodePath(path);
      editor.zoomStart = 0;
      editor.zoomEnd = 1;
      drawWaveform();
      stopPreview();
      setStatus(`Sample chargé: ${path.split(/[\\/]/).pop()}`);
    });

    canvas.addEventListener("wheel", (event) => {
      if (!editor.buffer) return;
      event.preventDefault();
      const direction = event.deltaY > 0 ? 1 : -1;
      if (event.shiftKey) {
        const next = editor.ampZoom * (direction > 0 ? 0.9 : 1.1);
        editor.ampZoom = Math.max(0.35, Math.min(8, next));
      } else {
        const pivot = xToNorm(eventToCanvasX(event));
        const range = editor.zoomEnd - editor.zoomStart;
        const nextRange = Math.max(0.01, Math.min(1, range * (direction > 0 ? 1.08 : 0.92)));
        const anchor = clamp01((pivot - editor.zoomStart) / Math.max(1e-6, range));
        let nextStart = pivot - anchor * nextRange;
        nextStart = Math.max(0, Math.min(1 - nextRange, nextStart));
        editor.zoomStart = nextStart;
        editor.zoomEnd = nextStart + nextRange;
      }
      drawWaveform();
    }, { passive: false });

    canvas.addEventListener("mousedown", (event) => {
      if (!editor.buffer) return;
      if (event.button === 1) {
        event.preventDefault();
        editor.isPanning = true;
        editor.panAnchorX = event.clientX;
        editor.panStartView = editor.zoomStart;
        return;
      }
      if (event.button !== 0) return;
      const x = eventToCanvasX(event);
      const marker = markerFromX(x);
      if (marker) {
        editor.dragging = marker;
        drawWaveform();
        return;
      }
      placeMarkerAt(x, "start");
    });

    canvas.addEventListener("mousemove", (event) => {
      if (!editor.buffer) return;
      if (editor.isPanning) {
        const range = editor.zoomEnd - editor.zoomStart;
        if (range >= 0.999) return;
        const rect = canvas.getBoundingClientRect();
        const deltaNorm = (event.clientX - editor.panAnchorX) / Math.max(1, rect.width);
        let nextStart = editor.panStartView - deltaNorm * range;
        nextStart = Math.max(0, Math.min(1 - range, nextStart));
        editor.zoomStart = nextStart;
        editor.zoomEnd = nextStart + range;
        drawWaveform();
        return;
      }
      if (!editor.dragging) return;
      placeMarkerAt(eventToCanvasX(event), editor.dragging);
    });

    const release = () => {
      editor.dragging = null;
      editor.isPanning = false;
      drawWaveform();
    };

    canvas.addEventListener("mouseup", release);
    canvas.addEventListener("mouseleave", release);
  }


  function ensurePreviewCtx() {
    if (previewState.ctx && previewState.ctx.state !== "closed") return previewState.ctx;
    const Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) return null;
    previewState.ctx = new Ctor();
    return previewState.ctx;
  }

  function stopPreview() {
    if (!previewState.active) return;
    previewState.active = false;
    try { previewState.source?.stop(); } catch (_) {}
    try { previewState.source?.disconnect(); } catch (_) {}
    try { previewState.gain?.disconnect(); } catch (_) {}
    previewState.source = null;
    previewState.gain = null;
    previewBtn?.classList.remove("active");
  }

  function startPreviewHold() {
    if (!editor.buffer) {
      setStatus("Pré-écoute impossible: aucun sample chargé.");
      return;
    }
    stopPreview();
    const ctx = ensurePreviewCtx();
    if (!ctx) return;

    const startNorm = clamp01(+startEl.value || editor.posStart);
    const endNorm = clamp01(+endEl.value || editor.posEnd);
    const orderedEnd = Math.max(startNorm + 0.001, endNorm);

    const startSec = startNorm * editor.buffer.duration;
    const endSec = orderedEnd * editor.buffer.duration;

    const source = ctx.createBufferSource();
    source.buffer = editor.buffer;
    source.loop = true;
    source.loopStart = startSec;
    source.loopEnd = endSec;

    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1.6, +gainEl.value || 1));

    source.connect(gain);
    gain.connect(ctx.destination);

    source.start();
    previewState.source = source;
    previewState.gain = gain;
    previewState.active = true;
    previewBtn?.classList.add("active");

    setStatus(`Pré-écoute active (${startNorm.toFixed(3)} → ${orderedEnd.toFixed(3)}).`);
    source.onended = () => {
      if (!previewState.active) return;
      stopPreview();
    };
  }

  function installPreviewInteractions() {
    if (!previewBtn) return;
    previewBtn.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      startPreviewHold();
    });
    const release = () => stopPreview();
    previewBtn.addEventListener("pointerup", release);
    previewBtn.addEventListener("pointerleave", release);
    previewBtn.addEventListener("pointercancel", release);

    previewBtn.addEventListener("keydown", (event) => {
      if (event.repeat) return;
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      startPreviewHold();
    });
    previewBtn.addEventListener("keyup", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      stopPreview();
    });
    previewBtn.addEventListener("blur", stopPreview);
  }

  function refreshMixOut() {
    if (!mixOutEl) return;
    mixOutEl.innerHTML = "";
    const channels = project?.mixer?.channels || [];
    channels.forEach((mix, index) => {
      const opt = document.createElement("option");
      opt.value = String(index + 1);
      opt.textContent = `${mix.name || `CH ${index + 1}`}`;
      mixOutEl.appendChild(opt);
    });
    mixOutEl.value = "1";
  }

  function createSamplePattern() {
    stopPreview();
    const name = String(nameEl?.value || "").trim();
    if (!name) {
      setStatus("Nom pattern requis.");
      return;
    }
    if (!editor.samplePath) {
      setStatus("Drop un sample dans le waveform avant validation.");
      return;
    }

    const beats = Math.max(1, Math.min(32, Math.floor(+beatsEl.value || 4)));
    const bars = Math.max(1, Math.ceil(beats / 4));
    const rootMidi = Math.max(24, Math.min(96, Math.floor(+rootMidiEl.value || 60)));
    const mixOut = Math.max(1, Math.floor(+mixOutEl.value || 1));

    const params = {
      samplePath: editor.samplePath,
      startNorm: clamp01(+startEl.value || editor.posStart),
      endNorm: clamp01(+endEl.value || editor.posEnd),
      patternBeats: beats,
      rootMidi,
      pitchMode: pitchModeEl.value || "chromatic",
      gain: Math.max(0, Math.min(1.6, +gainEl.value || 1)),
    };
    if (params.endNorm <= params.startNorm) params.endNorm = Math.min(1, params.startNorm + 0.001);

    const p = {
      id: gid("pat"),
      name,
      color: "#b28dff",
      lenBars: bars,
      kind: "sample_pattern",
      type: "sample_pattern",
      channels: [
        {
          id: gid("ch"),
          name: "Sample Paterne",
          preset: "Sample Paterne",
          color: "#b28dff",
          muted: false,
          params,
          mixOut,
          notes: [{ id: gid("note"), step: 0, len: 1, midi: rootMidi, vel: 110, selected: false }],
        },
      ],
      activeChannelId: null,
    };
    p.activeChannelId = p.channels[0].id;

    project.patterns.push(p);
    project.activePatternId = p.id;
    setStatus(`Pattern "${name}" créée (${beats} temps) et ajoutée à la banque Patterns.`);

    try { refreshUI(); } catch (_) {}
    try { renderAll(); } catch (_) {}
    try { renderPlaylist(); } catch (_) {}
  }

  startEl?.addEventListener("input", () => {
    stopPreview();
    editor.posStart = clamp01(+startEl.value || 0);
    if (editor.posStart >= editor.posEnd) editor.posEnd = Math.min(1, editor.posStart + 0.001);
    endEl.value = String(editor.posEnd);
    drawWaveform();
  });

  endEl?.addEventListener("input", () => {
    stopPreview();
    editor.posEnd = clamp01(+endEl.value || 1);
    if (editor.posEnd <= editor.posStart) editor.posStart = Math.max(0, editor.posEnd - 0.001);
    startEl.value = String(editor.posStart);
    drawWaveform();
  });

  saveBtn?.addEventListener("click", createSamplePattern);

  refreshMixOut();
  installInteractions();
  installPreviewInteractions();
  drawWaveform();
})(window);
