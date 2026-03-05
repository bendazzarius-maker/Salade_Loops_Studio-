// Skeleton files generated for Salad Loops Studio JUCE engine modularization.
// Generated: 2026-03-03
// NOTE: main.cpp is intentionally NOT included (already exists).
// These files are placeholders with TODOs and interface notes.

#pragma once
#include <cstdint>
#include <string>
#include <vector>

/*
  LfoPresetEngine (JUCE)
  =====================
  This module executes "preset LFOs" (sine/tri/saw/square/step) in real time.
  JS is UI-only and sends:
    - lfo.preset.set (id, type, rate/division, phase, smoothing)
    - lfo.route.set  (sourceId -> target param)
  The engine computes values (block or sample accurate) tied to transport.

  NOTE: This is distinct from LfoCurveEngine (Bezier curve LFO editor).
*/

enum class LfoPresetShape : uint8_t { Sine, Triangle, Saw, Square, Step, Random };

struct LfoPresetState {
  int id = 0;
  LfoPresetShape shape = LfoPresetShape::Sine;
  float rateHz = 1.0f;       // or derived from tempo division
  float depth = 1.0f;        // normalized 0..1
  float offset = 0.0f;       // normalized
  float phase = 0.0f;        // 0..1
  float smoothing = 0.0f;    // 0..1
  bool tempoSync = false;
  // TODO: division / beats-per-cycle
};

class LfoPresetEngine {
public:
  void prepare(double sampleRate);
  void setTransport(double bpm, int64_t samplePos, bool playing);

  // IPC handlers
  void upsertPreset(const LfoPresetState& st);
  void removePreset(int id);

  // Returns current value for a given preset id at current transport time
  float sampleValue(int id) const;

  // Advance phase by numFrames (block-accurate)
  void advance(int numFrames);

private:
  double mSampleRate = 44100.0;
  double mBpm = 120.0;
  int64_t mSamplePos = 0;
  bool mPlaying = false;

  std::vector<LfoPresetState> mPresets;

  const LfoPresetState* find(int id) const;
  LfoPresetState* find(int id);
};
