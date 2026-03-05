// Skeleton files generated for Salad Loops Studio JUCE engine modularization.
// Generated: 2026-03-03
// NOTE: main.cpp is intentionally NOT included (already exists).
// These files are placeholders with TODOs and interface notes.

#pragma once
#include "FxBase.h"

/*
  FxGrossBeat (JUCE)
  ------------------
  Port from fx_grossBeat.js:
  - tempo-synced volume gate / stutter
  - pattern is an array of 0/1 (or 0..1)
  - smoothing anti-click (ramps / one-pole smoothing)
  - DC blocker (HPF ~25Hz) before gating
  Params:
  - wet (0..1)
  - division (tempo sync)
  - pattern[] (step sequence)
  - smooth (0..1)
  - depth (0..1)
  - curvePow / epsilon (optional)
  Transport:
  - must be driven by BPM + samplePos + playing state for stable sync.
*/

class FxGrossBeat final : public FxBase {
public:
  const char* type() const override { return "grossbeat"; }

  void prepare(double sampleRate, int maxBlockSize, int numChannels) override;
  void setParam(const std::string& name, float value) override;
  void process(float** chans, int numChannels, int numFrames, double bpm, int64_t samplePos, bool playing) override;

private:
  double mSampleRate = 44100.0;
  int mMaxBlock = 512;
  int mNumCh = 2;

  // TODO: store params + dsp objects (DelayLine, LFO phase, filters, etc.)
};
