// Skeleton files generated for Salad Loops Studio JUCE engine modularization.
// Generated: 2026-03-03
// NOTE: main.cpp is intentionally NOT included (already exists).
// These files are placeholders with TODOs and interface notes.

#include "LfoCurveEngine.h"

void LfoCurveEngine::prepare(double sampleRate) { mSampleRate = sampleRate; }

void LfoCurveEngine::setTransport(double bpm, int64_t samplePos, bool playing) {
  mBpm = bpm; mSamplePos = samplePos; mPlaying = playing;
}

const LfoCurveState* LfoCurveEngine::find(int id) const {
  for (auto& c : mCurves) if (c.id == id) return &c;
  return nullptr;
}
LfoCurveState* LfoCurveEngine::find(int id) {
  for (auto& c : mCurves) if (c.id == id) return &c;
  return nullptr;
}

void LfoCurveEngine::upsertCurve(const LfoCurveState& st) {
  if (auto* c = find(st.id)) { *c = st; return; }
  mCurves.push_back(st);
}

void LfoCurveEngine::removeCurve(int id) {
  for (size_t i=0;i<mCurves.size();++i) {
    if (mCurves[i].id == id) { mCurves.erase(mCurves.begin() + (long)i); return; }
  }
}

float LfoCurveEngine::evalBezierY(const Bezier3& b, float t) {
  // Quadratic bezier with 3 points A,B,C:
  // P(t) = (1-t)^2*A + 2(1-t)t*B + t^2*C
  float u = 1.0f - t;
  float y = (u*u)*b.ay + 2.0f*(u*t)*b.by + (t*t)*b.cy;
  return y;
}

float LfoCurveEngine::sampleValue(int id) const {
  auto* c = find(id);
  if (!c) return 0.0f;
  float y = evalBezierY(c->curve, c->phase);
  return c->offset + c->depth * y;
}

void LfoCurveEngine::advance(int numFrames) {
  (void)numFrames;
  // TODO: advance phases using tempoSync mapping and length.
}
