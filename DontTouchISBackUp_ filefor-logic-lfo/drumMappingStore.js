/* ================= Electro DAW | drumMappingStore.js ================= */
(function(){
  const listeners = new Set();

  const DEFAULT_FAMILIES = [
    'Jazz Studio',
    'Rock Metal Kit',
    'Trap Sub 808',
    'Electro FM Lab',
    'Orchestral Hybrid'
  ];

  function clone(v){
    return JSON.parse(JSON.stringify(v));
  }

  function makeDefaultRows(){
    return [
      { noteLabel: 'C2',  midiNote: 36, voiceKey: 'kickMain',   displayName: 'Kick Main',     family: 'kick',   mixChannel: 1, presetId: 'kick_sub',          macro: 'Punch',         color: '#ff6b6b' },
      { noteLabel: 'C#2', midiNote: 37, voiceKey: 'rimShot',    displayName: 'Rim Shot',      family: 'snare',  mixChannel: 2, presetId: 'rimshot_morph',     macro: 'Click',         color: '#ffa94d' },
      { noteLabel: 'D2',  midiNote: 38, voiceKey: 'snareMain',  displayName: 'Snare Main',    family: 'snare',  mixChannel: 2, presetId: 'snare_main',        macro: 'Snap',          color: '#ffd43b' },
      { noteLabel: 'D#2', midiNote: 39, voiceKey: 'clapLayer',  displayName: 'Clap Layer',    family: 'snare',  mixChannel: 2, presetId: 'clap_layer',        macro: 'Width',         color: '#fcc419' },
      { noteLabel: 'F#2', midiNote: 42, voiceKey: 'hatClosed',  displayName: 'Hat Closed',    family: 'hat',    mixChannel: 3, presetId: 'hat_closed_bright', macro: 'Brightness',    color: '#63e6be' },
      { noteLabel: 'G#2', midiNote: 44, voiceKey: 'hatPedal',   displayName: 'Pedal Hat',     family: 'hat',    mixChannel: 3, presetId: 'hat_pedal',         macro: 'Tight',         color: '#38d9a9' },
      { noteLabel: 'A#2', midiNote: 46, voiceKey: 'hatOpen',    displayName: 'Hat Open',      family: 'hat',    mixChannel: 3, presetId: 'hat_open_air',      macro: 'Air',           color: '#20c997' },
      { noteLabel: 'F2',  midiNote: 41, voiceKey: 'tomLow',     displayName: 'Tom Low',       family: 'tom',    mixChannel: 4, presetId: 'tom_low',           macro: 'Body',          color: '#74c0fc' },
      { noteLabel: 'A2',  midiNote: 45, voiceKey: 'tomMid',     displayName: 'Tom Mid',       family: 'tom',    mixChannel: 4, presetId: 'tom_mid',           macro: 'Punch',         color: '#4dabf7' },
      { noteLabel: 'B2',  midiNote: 47, voiceKey: 'tomHigh',    displayName: 'Tom High',      family: 'tom',    mixChannel: 4, presetId: 'tom_high',          macro: 'Attack',        color: '#339af0' },
      { noteLabel: 'C#3', midiNote: 49, voiceKey: 'crash1',     displayName: 'Crash 1',       family: 'cymbal', mixChannel: 5, presetId: 'crash_main',        macro: 'Wash',          color: '#b197fc' },
      { noteLabel: 'D#3', midiNote: 51, voiceKey: 'rideMain',   displayName: 'Ride Main',     family: 'cymbal', mixChannel: 5, presetId: 'ride_main',         macro: 'Stick',         color: '#9775fa' },
      { noteLabel: 'F3',  midiNote: 53, voiceKey: 'rideBell',   displayName: 'Ride Bell',     family: 'cymbal', mixChannel: 5, presetId: 'ride_bell',         macro: 'Bell',          color: '#845ef7' },
      { noteLabel: 'G3',  midiNote: 55, voiceKey: 'splash',     displayName: 'Splash',        family: 'cymbal', mixChannel: 5, presetId: 'splash',            macro: 'Splash',        color: '#7950f2' },
      { noteLabel: 'A3',  midiNote: 57, voiceKey: 'crash2',     displayName: 'Crash 2',       family: 'cymbal', mixChannel: 5, presetId: 'crash_wide',        macro: 'Spread',        color: '#7048e8' },
      { noteLabel: 'E3',  midiNote: 52, voiceKey: 'china',      displayName: 'China',         family: 'cymbal', mixChannel: 5, presetId: 'china',             macro: 'Trash',         color: '#6741d9' }
    ];
  }

  function normalizeRow(row){
    const src = row || {};
    return {
      noteLabel: String(src.noteLabel || ''),
      midiNote: Number.isFinite(Number(src.midiNote)) ? Number(src.midiNote) : 36,
      voiceKey: String(src.voiceKey || ''),
      displayName: String(src.displayName || src.voiceKey || ''),
      family: String(src.family || 'perc'),
      mixChannel: Math.max(1, Math.min(16, Number(src.mixChannel) || 1)),
      presetId: String(src.presetId || ''),
      macro: String(src.macro || ''),
      color: String(src.color || '#3b82f6')
    };
  }

  let state = {
    selectedFamily: DEFAULT_FAMILIES[0],
    rows: makeDefaultRows().map(normalizeRow)
  };

  function emit(){
    const snapshot = clone(state);
    listeners.forEach(function(fn){
      try { fn(snapshot); } catch (err) { console.warn('[drumMappingStore] listener error', err); }
    });
  }

  function indexOfMidi(midiNote){
    return state.rows.findIndex(function(row){ return row.midiNote === midiNote; });
  }

  window.DrumMappingStore = {
    getState: function(){ return clone(state); },
    getFamilies: function(){ return DEFAULT_FAMILIES.slice(); },
    subscribe: function(fn){
      if (typeof fn !== 'function') return function(){};
      listeners.add(fn);
      try { fn(clone(state)); } catch (_) {}
      return function(){ listeners.delete(fn); };
    },
    reset: function(){
      state = { selectedFamily: DEFAULT_FAMILIES[0], rows: makeDefaultRows().map(normalizeRow) };
      emit();
      return clone(state);
    },
    replaceState: function(nextState){
      const src = nextState || {};
      state = {
        selectedFamily: String(src.selectedFamily || DEFAULT_FAMILIES[0]),
        rows: Array.isArray(src.rows) ? src.rows.map(normalizeRow) : makeDefaultRows().map(normalizeRow)
      };
      emit();
      return clone(state);
    },
    setSelectedFamily: function(family){
      state.selectedFamily = String(family || DEFAULT_FAMILIES[0]);
      emit();
      return clone(state);
    },
    getRowByMidi: function(midiNote){
      const idx = indexOfMidi(Number(midiNote));
      return idx >= 0 ? clone(state.rows[idx]) : null;
    },
    updateRow: function(midiNote, patch){
      const idx = indexOfMidi(Number(midiNote));
      if (idx < 0) return null;
      state.rows[idx] = normalizeRow(Object.assign({}, state.rows[idx], patch || {}));
      emit();
      return clone(state.rows[idx]);
    },
    upsertRow: function(row){
      const normalized = normalizeRow(row);
      const idx = indexOfMidi(normalized.midiNote);
      if (idx >= 0) state.rows[idx] = normalized;
      else state.rows.push(normalized);
      state.rows.sort(function(a, b){ return a.midiNote - b.midiNote; });
      emit();
      return clone(normalized);
    },
    removeRow: function(midiNote){
      const idx = indexOfMidi(Number(midiNote));
      if (idx < 0) return false;
      state.rows.splice(idx, 1);
      emit();
      return true;
    },
    exportForProject: function(){
      return clone(state);
    }
  };
})();
