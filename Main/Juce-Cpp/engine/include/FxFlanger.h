// Skeleton files generated for Salad Loops Studio JUCE engine modularization.
// Generated: 2026-03-03
// NOTE: main.cpp is intentionally NOT included (already exists).
// These files are placeholders with TODOs and interface notes.

#pragma once
#include "FxBase.h"

/*
  FxFlanger (JUCE)
  ---------------
  Port from fx_flanger.js:
  - very short base delay
  - small depth
  - feedback
  - wet/dry
  Params:
  - wet, rateHz, depthSec, baseSec, feedback
*/

class FxFlanger final : public FxBase {
public:
  const char* type() const override { return "flanger"; }

  void prepare(double sampleRate, int maxBlockSize, int numChannels) override;
  void setParam(const std::string& name, float value) override;
  void process(float** chans, int numChannels, int numFrames, double bpm, int64_t samplePos, bool playing) override;

private:
  double mSampleRate = 44100.0;
  int mMaxBlock = 512;
  int mNumCh = 2;

  // TODO: store params + dsp objects (DelayLine, LFO phase, filters, etc.)
};
