#include "instruments/SampleTouskiInstrument.h"

namespace sls::inst {

SampleTouskiInstrument::SampleTouskiInstrument(LoadSampleFn loadSampleFn)
    : loadSampleFn_(std::move(loadSampleFn)) {}

void SampleTouskiInstrument::setLoadSampleFn(LoadSampleFn fn) { loadSampleFn_ = std::move(fn); }
void SampleTouskiInstrument::setSampleRate(double sr) { sampleRate_ = std::max(1.0, sr); }
double SampleTouskiInstrument::getSampleRate() const noexcept { return sampleRate_; }

float SampleTouskiInstrument::clamp01(double v) {
  return (float) juce::jlimit(0.0, 1.0, v);
}

int SampleTouskiInstrument::getIntProp(const juce::DynamicObject* o, const juce::Identifier& key, int fallback) {
  return (o && o->hasProperty(key)) ? (int) o->getProperty(key) : fallback;
}

double SampleTouskiInstrument::getDoubleProp(const juce::DynamicObject* o, const juce::Identifier& key, double fallback) {
  return (o && o->hasProperty(key)) ? (double) o->getProperty(key) : fallback;
}

juce::String SampleTouskiInstrument::getStringProp(const juce::DynamicObject* o,
                                                   const juce::Identifier& key,
                                                   const juce::String& fallback) {
  return (o && o->hasProperty(key)) ? o->getProperty(key).toString() : fallback;
}

float SampleTouskiInstrument::readPctOrNorm(const juce::DynamicObject* o,
                                            const juce::Identifier& normKey,
                                            const juce::Identifier& pctKey,
                                            float fallbackNorm) {
  if (!o) return fallbackNorm;
  if (o->hasProperty(normKey)) return clamp01((double) o->getProperty(normKey));
  if (o->hasProperty(pctKey))  return clamp01((double) o->getProperty(pctKey) / 100.0);
  return fallbackNorm;
}

void SampleTouskiInstrument::applyRuntimeParamsFromObject(RuntimeParams& p,
                                                          const juce::DynamicObject* o,
                                                          bool allowProgramPath) {
  if (!o) return;

  if (allowProgramPath && o->hasProperty("programPath"))
    p.programPath = getStringProp(o, "programPath", p.programPath);

  p.rootMidi = getIntProp(o, "rootMidi", p.rootMidi);
  p.posAction = readPctOrNorm(o, "posAction", "keyActionPct", p.posAction);
  p.posLoopStart = readPctOrNorm(o, "posLoopStart", "loopStartPct", p.posLoopStart);
  p.posLoopEnd = readPctOrNorm(o, "posLoopEnd", "loopEndPct", p.posLoopEnd);
  p.posRelease = readPctOrNorm(o, "posRelease", "releasePct", p.posRelease);
  p.sustainPct = (float) juce::jlimit(0.0, 100.0, getDoubleProp(o, "sustainPct", p.sustainPct));
  p.loopCrossfadeMs = (float) juce::jlimit(0.0, 250.0, getDoubleProp(o, "loopCrossfadeMs", getDoubleProp(o, "smoothingMs", p.loopCrossfadeMs)));
  p.releaseTailMs = (float) juce::jlimit(0.0, 250.0, getDoubleProp(o, "releaseTailMs", p.releaseTailMs));
  p.fadeInMs = (float) juce::jlimit(0.0, 50.0, getDoubleProp(o, "fadeInMs", p.fadeInMs));
  p.zeroCrossSearchMs = (float) juce::jlimit(0.0, 50.0, getDoubleProp(o, "zeroCrossSearchMs", getDoubleProp(o, "zeroCrossWindowMs", p.zeroCrossSearchMs)));
  p.grainSizeMs = (float) juce::jlimit(8.0, 250.0, getDoubleProp(o, "grainSizeMs", getDoubleProp(o, "stretchGrainMs", p.grainSizeMs)));
  p.grainOverlap = (float) juce::jlimit(0.1, 0.95, getDoubleProp(o, "grainOverlap", p.grainOverlap));
  p.grainJitterMs = (float) juce::jlimit(0.0, 80.0, getDoubleProp(o, "grainJitterMs", getDoubleProp(o, "stretchJitterMs", p.grainJitterMs)));
  p.seamDiffuse = readPctOrNorm(o, "seamDiffuse", "seamDiffusePct", p.seamDiffuse);

  if (o->hasProperty("smartPlayback")) {
    if (auto* sp = o->getProperty("smartPlayback").getDynamicObject())
      p.smartPlaybackMode = getStringProp(sp, "mode", p.smartPlaybackMode);
  }

  if (o->hasProperty("pitchInterpolation")) {
    if (auto* pi = o->getProperty("pitchInterpolation").getDynamicObject())
      p.pitchEngine = getStringProp(pi, "engine", p.pitchEngine);
  } else if (o->hasProperty("pitchEngine")) {
    p.pitchEngine = getStringProp(o, "pitchEngine", p.pitchEngine);
  }
}

void SampleTouskiInstrument::normalizeParams(RuntimeParams& p) {
  p.posAction = clamp01(p.posAction);
  p.posLoopStart = clamp01(p.posLoopStart);
  p.posLoopEnd = clamp01(p.posLoopEnd);
  p.posRelease = clamp01(p.posRelease);

  p.posLoopStart = std::max(p.posAction + 0.001f, p.posLoopStart);
  p.posLoopEnd = std::max(p.posLoopStart + 0.001f, p.posLoopEnd);
  p.posRelease = std::max(p.posLoopEnd, p.posRelease);

  p.sustainPct = (float) juce::jlimit(0.0, 100.0, (double) p.sustainPct);
  p.loopCrossfadeMs = (float) juce::jlimit(0.0, 250.0, (double) p.loopCrossfadeMs);
  p.releaseTailMs = (float) juce::jlimit(0.0, 250.0, (double) p.releaseTailMs);
  p.fadeInMs = (float) juce::jlimit(0.0, 50.0, (double) p.fadeInMs);
  p.zeroCrossSearchMs = (float) juce::jlimit(0.0, 50.0, (double) p.zeroCrossSearchMs);
  p.grainSizeMs = (float) juce::jlimit(8.0, 250.0, (double) p.grainSizeMs);
  p.grainOverlap = (float) juce::jlimit(0.1, 0.95, (double) p.grainOverlap);
  p.grainJitterMs = (float) juce::jlimit(0.0, 80.0, (double) p.grainJitterMs);
  p.seamDiffuse = clamp01(p.seamDiffuse);

  if (p.smartPlaybackMode.isEmpty())
    p.smartPlaybackMode = "hold_loop_then_release";
  if (p.pitchEngine.isEmpty())
    p.pitchEngine = "granular";
}

bool SampleTouskiInstrument::wantsGranularPitchEngine(const juce::String& engineName) {
  const auto e = engineName.toLowerCase();
  return e.contains("gran") || e.contains("stretch") || e.contains("phase") || e.contains("vocoder");
}

SampleTouskiInstrument::Zone SampleTouskiInstrument::makeZoneFromObject(const juce::DynamicObject* o,
                                                                        const juce::File& baseDir,
                                                                        const RuntimeParams& parent) const {
  Zone z;
  z.rootMidi = parent.rootMidi;
  z.posAction = parent.posAction;
  z.posLoopStart = parent.posLoopStart;
  z.posLoopEnd = parent.posLoopEnd;
  z.posRelease = parent.posRelease;
  z.sustainPct = parent.sustainPct;
  z.loopCrossfadeMs = parent.loopCrossfadeMs;
  z.releaseTailMs = parent.releaseTailMs;
  z.fadeInMs = parent.fadeInMs;
  z.zeroCrossSearchMs = parent.zeroCrossSearchMs;
  z.grainSizeMs = parent.grainSizeMs;
  z.grainOverlap = parent.grainOverlap;
  z.grainJitterMs = parent.grainJitterMs;
  z.seamDiffuse = parent.seamDiffuse;

  if (!o) return z;

  z.rootMidi = getIntProp(o, "rootMidi", getIntProp(o, "note", parent.rootMidi));
  z.posAction = readPctOrNorm(o, "posAction", "keyActionPct", parent.posAction);
  z.posLoopStart = readPctOrNorm(o, "posLoopStart", "loopStartPct", parent.posLoopStart);
  z.posLoopEnd = readPctOrNorm(o, "posLoopEnd", "loopEndPct", parent.posLoopEnd);
  z.posRelease = readPctOrNorm(o, "posRelease", "releasePct", parent.posRelease);
  z.sustainPct = (float) juce::jlimit(0.0, 100.0, getDoubleProp(o, "sustainPct", parent.sustainPct));
  z.loopCrossfadeMs = (float) juce::jlimit(0.0, 250.0, getDoubleProp(o, "loopCrossfadeMs", getDoubleProp(o, "smoothingMs", parent.loopCrossfadeMs)));
  z.releaseTailMs = (float) juce::jlimit(0.0, 250.0, getDoubleProp(o, "releaseTailMs", parent.releaseTailMs));
  z.fadeInMs = (float) juce::jlimit(0.0, 50.0, getDoubleProp(o, "fadeInMs", parent.fadeInMs));
  z.zeroCrossSearchMs = (float) juce::jlimit(0.0, 50.0, getDoubleProp(o, "zeroCrossSearchMs", getDoubleProp(o, "zeroCrossWindowMs", parent.zeroCrossSearchMs)));
  z.grainSizeMs = (float) juce::jlimit(8.0, 250.0, getDoubleProp(o, "grainSizeMs", getDoubleProp(o, "stretchGrainMs", parent.grainSizeMs)));
  z.grainOverlap = (float) juce::jlimit(0.1, 0.95, getDoubleProp(o, "grainOverlap", parent.grainOverlap));
  z.grainJitterMs = (float) juce::jlimit(0.0, 80.0, getDoubleProp(o, "grainJitterMs", getDoubleProp(o, "stretchJitterMs", parent.grainJitterMs)));
  z.seamDiffuse = readPctOrNorm(o, "seamDiffuse", "seamDiffusePct", parent.seamDiffuse);

  juce::String rawPath = getStringProp(o, "path", getStringProp(o, "samplePath", {}));
  if (rawPath.isEmpty() && o->hasProperty("sample")) {
    if (auto* so = o->getProperty("sample").getDynamicObject())
      rawPath = getStringProp(so, "path", getStringProp(so, "relativePath", {}));
  }
  if (rawPath.isEmpty()) rawPath = getStringProp(o, "relativePath", {});

  if (rawPath.isNotEmpty()) {
    juce::File f(rawPath);
    if (!juce::File::isAbsolutePath(rawPath)) f = baseDir.getChildFile(rawPath);
    z.samplePath = f.getFullPathName();
    if (loadSampleFn_) z.sample = loadSampleFn_(z.samplePath);
  }

  z.posLoopStart = std::max(z.posAction + 0.001f, z.posLoopStart);
  z.posLoopEnd = std::max(z.posLoopStart + 0.001f, z.posLoopEnd);
  z.posRelease = std::max(z.posLoopEnd, z.posRelease);
  z.loopEnabled = z.posLoopEnd > z.posLoopStart;
  return z;
}

const SampleTouskiInstrument::Zone* SampleTouskiInstrument::findBestZone(const ProgramState& state, int midiNote) const {
  const Zone* best = nullptr;
  int bestDist = std::numeric_limits<int>::max();

  for (const auto& kv : state.zones) {
    if (!kv.second.sample && kv.second.samplePath.isEmpty()) continue;
    const int dist = std::abs(kv.first - midiNote);
    if (dist < bestDist) {
      bestDist = dist;
      best = &kv.second;
    }
  }
  return best;
}

bool SampleTouskiInstrument::loadProgramFromRootObject(ProgramState& state,
                                                       const juce::DynamicObject* root,
                                                       const juce::File& baseDir,
                                                       juce::String* errorMessage) const {
  if (!root) {
    if (errorMessage) *errorMessage = "Invalid Touski program root";
    return false;
  }

  applyRuntimeParamsFromObject(state.params, root, false);
  normalizeParams(state.params);

  auto readArray = [&](const juce::Identifier& key) {
    if (!root->hasProperty(key)) return;
    auto vv = root->getProperty(key);
    if (!vv.isArray()) return;
    for (const auto& item : *vv.getArray()) {
      auto* o = item.getDynamicObject();
      if (!o) continue;
      auto zone = makeZoneFromObject(o, baseDir, state.params);
      if (zone.sample || zone.samplePath.isNotEmpty()) state.zones[zone.rootMidi] = std::move(zone);
    }
  };

  readArray("zones");
  readArray("samples");
  readArray("mapping");

  if (state.zones.empty() && root->hasProperty("sample")) {
    if (auto* so = root->getProperty("sample").getDynamicObject()) {
      auto zone = makeZoneFromObject(so, baseDir, state.params);
      zone.rootMidi = state.params.rootMidi;
      if (zone.sample || zone.samplePath.isNotEmpty()) state.zones[zone.rootMidi] = std::move(zone);
    }
  }

  if (state.zones.empty()) {
    if (errorMessage) *errorMessage = "No samples in touski program";
    return false;
  }

  return true;
}

bool SampleTouskiInstrument::loadProgram(const juce::String& instId,
                                         const juce::var& inlineProgramPayload,
                                         juce::String* errorMessage) {
  ProgramState state;
  state.params.programPath = {};

  const auto* payload = inlineProgramPayload.getDynamicObject();
  if (payload)
    applyRuntimeParamsFromObject(state.params, payload, true);
  normalizeParams(state.params);

  if (payload && payload->hasProperty("samples")) {
    if (!loadProgramFromRootObject(state, payload, juce::File(), errorMessage)) {
      if (state.params.programPath.isEmpty()) return false;
      state.zones.clear();
    }
  }

  if (state.zones.empty() && state.params.programPath.isNotEmpty()) {
    juce::File f(state.params.programPath);
    if (!f.existsAsFile()) {
      if (errorMessage) *errorMessage = "Touski program file not found";
      return false;
    }

    juce::var parsed = juce::JSON::parse(f.loadFileAsString());
    auto* root = parsed.getDynamicObject();
    if (!root) {
      if (errorMessage) *errorMessage = "Invalid touski program json";
      return false;
    }

    if (!loadProgramFromRootObject(state, root, f.getParentDirectory(), errorMessage))
      return false;
  }

  if (state.zones.empty()) {
    if (errorMessage) *errorMessage = "No samples in touski program";
    return false;
  }

  programs_[instId] = std::move(state);
  return true;
}

bool SampleTouskiInstrument::setParams(const juce::String& instId,
                                       const juce::var& paramsPayload,
                                       juce::String* errorMessage) {
  auto it = programs_.find(instId);
  if (it == programs_.end()) {
    if (errorMessage) *errorMessage = "Touski program not loaded";
    return false;
  }

  auto& state = it->second;
  auto* requestObj = paramsPayload.getDynamicObject();
  if (!requestObj) return true;

  auto* pp = requestObj;
  if (requestObj->hasProperty("params")) {
    if (auto* nested = requestObj->getProperty("params").getDynamicObject())
      pp = nested;
  }

  if (requestObj->hasProperty("programPath"))
    state.params.programPath = getStringProp(requestObj, "programPath", state.params.programPath);
  else if (pp->hasProperty("programPath"))
    state.params.programPath = getStringProp(pp, "programPath", state.params.programPath);

  applyRuntimeParamsFromObject(state.params, pp, false);
  normalizeParams(state.params);

  for (auto& kv : state.zones) {
    auto& z = kv.second;
    z.posAction = state.params.posAction;
    z.posLoopStart = state.params.posLoopStart;
    z.posLoopEnd = state.params.posLoopEnd;
    z.posRelease = state.params.posRelease;
    z.sustainPct = state.params.sustainPct;
    z.loopCrossfadeMs = state.params.loopCrossfadeMs;
    z.releaseTailMs = state.params.releaseTailMs;
    z.fadeInMs = state.params.fadeInMs;
    z.zeroCrossSearchMs = state.params.zeroCrossSearchMs;
    z.grainSizeMs = state.params.grainSizeMs;
    z.grainOverlap = state.params.grainOverlap;
    z.grainJitterMs = state.params.grainJitterMs;
    z.seamDiffuse = state.params.seamDiffuse;
    z.loopEnabled = z.posLoopEnd > z.posLoopStart;
  }

  return true;
}

bool SampleTouskiInstrument::hasProgram(const juce::String& instId) const {
  return programs_.find(instId) != programs_.end();
}

const SampleTouskiInstrument::ProgramState* SampleTouskiInstrument::getProgram(const juce::String& instId) const {
  auto it = programs_.find(instId);
  return it != programs_.end() ? &it->second : nullptr;
}

bool SampleTouskiInstrument::buildVoiceOn(const juce::String& instId,
                                          int mixCh,
                                          int note,
                                          float velocity,
                                          VoiceSpec& outVoice,
                                          juce::String* errorMessage) const {
  const auto* state = getProgram(instId);
  if (!state) {
    if (errorMessage) *errorMessage = "Touski program not loaded";
    return false;
  }

  const auto* zone = findBestZone(*state, note);
  if (!zone || zone->samplePath.isEmpty()) {
    if (errorMessage) *errorMessage = "No sample for note";
    return false;
  }

  outVoice = {};
  outVoice.valid = true;
  outVoice.instId = instId;
  outVoice.smartPlaybackMode = state->params.smartPlaybackMode;
  outVoice.pitchEngine = state->params.pitchEngine;
  outVoice.note = note;
  outVoice.mixCh = juce::jmax(1, mixCh);
  outVoice.samplePath = zone->samplePath;
  outVoice.rootMidi = zone->rootMidi;
  outVoice.sample = zone->sample;

  outVoice.posAction = zone->posAction;
  outVoice.posLoopStart = zone->posLoopStart;
  outVoice.posLoopEnd = zone->posLoopEnd;
  outVoice.posRelease = zone->posRelease;

  outVoice.loopEnabled = state->params.smartPlaybackMode.equalsIgnoreCase("hold_loop_then_release") && zone->loopEnabled;
  outVoice.useGranularHold = outVoice.loopEnabled && wantsGranularPitchEngine(state->params.pitchEngine);
  outVoice.releasing = false;

  outVoice.fadeInSamples = std::max(0, (int) std::llround(sampleRate_ * (zone->fadeInMs * 0.001f)));
  outVoice.fadeInTotal = std::max(16, outVoice.fadeInSamples);
  outVoice.fadeInRemaining = outVoice.fadeInTotal;
  outVoice.loopCrossfadeSamples = std::max(8, (int) std::llround(sampleRate_ * (zone->loopCrossfadeMs * 0.001f)));
  outVoice.releaseTailSamples = std::max(0, (int) std::llround(sampleRate_ * (zone->releaseTailMs * 0.001f)));
  outVoice.zeroCrossSearchSamples = std::max(0, (int) std::llround(sampleRate_ * (zone->zeroCrossSearchMs * 0.001f)));
  outVoice.grainSizeSamples = std::max(64, (int) std::llround(sampleRate_ * (zone->grainSizeMs * 0.001f)));
  outVoice.grainHopSamples = std::max(16, (int) std::llround((double) outVoice.grainSizeSamples * (1.0 - (double) zone->grainOverlap)));
  outVoice.grainJitterSamples = std::max(0, (int) std::llround(sampleRate_ * (zone->grainJitterMs * 0.001f)));
  outVoice.seamDiffuse = clamp01(zone->seamDiffuse);

  outVoice.rateRatio = std::max(0.0001, std::pow(2.0, (double) (note - zone->rootMidi) / 12.0));

  const int total = zone->sample ? zone->sample->buffer.getNumSamples() : 0;
  if (total > 1) {
    outVoice.start = juce::jlimit(0, std::max(0, total - 1), (int) std::floor((double) zone->posAction * total));
    outVoice.loopStart = juce::jlimit(0, std::max(0, total - 1), (int) std::floor((double) zone->posLoopStart * total));
    outVoice.loopEnd = juce::jlimit(outVoice.loopStart + 1, std::max(outVoice.loopStart + 1, total), (int) std::ceil((double) zone->posLoopEnd * total));
    outVoice.releaseEnd = juce::jlimit(outVoice.loopEnd, std::max(outVoice.loopEnd, total), (int) std::ceil((double) zone->posRelease * total));
    outVoice.end = std::max(outVoice.loopEnd, outVoice.releaseEnd);
  }

  const float vel = (float) juce::jlimit(0.0, 1.0, (double) velocity);
  outVoice.gainL = vel;
  outVoice.gainR = vel;
  return true;
}

bool SampleTouskiInstrument::applyNoteOff(const juce::String& instId,
                                          int mixCh,
                                          int note,
                                          std::vector<VoiceSpec*>& activeVoices) const {
  const bool holdLoopThenRelease = shouldHoldLoopOnNoteOff(instId);

  bool changed = false;
  for (auto* v : activeVoices) {
    if (!v || !v->valid) continue;
    if (v->instId != instId || v->mixCh != mixCh || v->note != note) continue;
    v->releasing = true;
    if (holdLoopThenRelease)
      v->loopEnabled = false;
    v->fadeOutTotal = 0;
    v->fadeOutRemaining = 0;
    changed = true;
  }
  return changed;
}

bool SampleTouskiInstrument::shouldHoldLoopOnNoteOff(const juce::String& instId) const {
  const auto* state = getProgram(instId);
  return state && state->params.smartPlaybackMode.equalsIgnoreCase("hold_loop_then_release");
}

void SampleTouskiInstrument::clearProgram(const juce::String& instId) {
  programs_.erase(instId);
}

void SampleTouskiInstrument::clearAll() {
  programs_.clear();
}

} // namespace sls::inst
