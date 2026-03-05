// Skeleton files generated for Salad Loops Studio JUCE engine modularization.
// Generated: 2026-03-03
// NOTE: main.cpp is intentionally NOT included (already exists).
// These files are placeholders with TODOs and interface notes.

#pragma once
#include <cstdint>
#include <vector>

/*
  LfoCurveEngine (JUCE)
  ====================
  Executes Bezier-curve LFOs in real time (distinct from LfoPresetEngine).
  JS editor (lfoCurveEditor.js) defines curve points and sends them to C++.

  Expected IPC:
    - lfo.curve.set (id, pointsA/B/C, length, tempo sync, smoothing)
    - lfo.route.set (sourceId -> target param)

  Curve spec (match your UI):
    - 3 control points (A,B,C) in normalized coordinates
    - optional resolution / lookup table
    - length in beats or steps (define convention)
*/

struct Bezier3 {
  // normalized [0..1]
  float ax=0.0f, ay=0.0f;
  float bx=0.5f, by=0.5f;
  float cx=1.0f, cy=1.0f;
};

struct LfoCurveState {
  int id=0;
  Bezier3 curve;
  float depth=1.0f;
  float offset=0.0f;
  float phase=0.0f;       // 0..1
  float smoothing=0.0f;
  bool tempoSync=false;
  // TODO: lengthBeats, division, etc.
};

class LfoCurveEngine {
public:
  void prepare(double sampleRate);
  void setTransport(double bpm, int64_t samplePos, bool playing);

  void upsertCurve(const LfoCurveState& st);
  void removeCurve(int id);

  float sampleValue(int id) const;
  void advance(int numFrames);

private:
  double mSampleRate=44100.0;
  double mBpm=120.0;
  int64_t mSamplePos=0;
  bool mPlaying=false;

  std::vector<LfoCurveState> mCurves;

  const LfoCurveState* find(int id) const;
  LfoCurveState* find(int id);

  static float evalBezierY(const Bezier3& b, float t);
};
