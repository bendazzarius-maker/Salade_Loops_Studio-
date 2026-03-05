// Skeleton files generated for Salad Loops Studio JUCE engine modularization.
// Generated: 2026-03-03
// NOTE: main.cpp is intentionally NOT included (already exists).
// These files are placeholders with TODOs and interface notes.

#pragma once
#include "FxBase.h"

/*
  FxChorus (JUCE)
  --------------
  Port from fx_chorus.js:
  - base delay ~ 0.018s
  - LFO modulates delayTime: delay = base + depth * sin(phase)
  - feedback gain
  - wet/dry
  Params:
  - wet, rateHz, depthSec, baseSec, feedback
*/

class FxChorus final : public FxBase {
public:
  const char* type() const override { return "chorus"; }

  void prepare(double sampleRate, int maxBlockSize, int numChannels) override;
  void setParam(const std::string& name, float value) override;
  void process(float** chans, int numChannels, int numFrames, double bpm, int64_t samplePos, bool playing) override;

private:
  double mSampleRate = 44100.0;
  int mMaxBlock = 512;
  int mNumCh = 2;

  // TODO: store params + dsp objects (DelayLine, LFO phase, filters, etc.)
};
