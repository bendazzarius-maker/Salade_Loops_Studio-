// Skeleton files generated for Salad Loops Studio JUCE engine modularization.
// Generated: 2026-03-03
// NOTE: main.cpp is intentionally NOT included (already exists).
// These files are placeholders with TODOs and interface notes.

#include "LfoPresetEngine.h"
#include <cmath>

void LfoPresetEngine::prepare(double sampleRate) {
  mSampleRate = sampleRate;
}

void LfoPresetEngine::setTransport(double bpm, int64_t samplePos, bool playing) {
  mBpm = bpm;
  mSamplePos = samplePos;
  mPlaying = playing;
}

const LfoPresetState* LfoPresetEngine::find(int id) const {
  for (auto& p : mPresets) if (p.id == id) return &p;
  return nullptr;
}
LfoPresetState* LfoPresetEngine::find(int id) {
  for (auto& p : mPresets) if (p.id == id) return &p;
  return nullptr;
}

void LfoPresetEngine::upsertPreset(const LfoPresetState& st) {
  if (auto* p = find(st.id)) { *p = st; return; }
  mPresets.push_back(st);
}

void LfoPresetEngine::removePreset(int id) {
  for (size_t i=0;i<mPresets.size();++i) {
    if (mPresets[i].id == id) { mPresets.erase(mPresets.begin()+ (long)i); return; }
  }
}

float LfoPresetEngine::sampleValue(int id) const {
  auto* p = find(id);
  if (!p) return 0.0f;

  // TODO: compute based on p->shape and p->phase, apply depth/offset and smoothing.
  // Placeholder:
  float v = std::sin(2.0f * 3.1415926f * p->phase);
  return p->offset + p->depth * v;
}

void LfoPresetEngine::advance(int numFrames) {
  (void)numFrames;
  // TODO: advance phases using rateHz or tempoSync mapping.
}
