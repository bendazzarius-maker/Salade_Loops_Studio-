// Skeleton files generated for Salad Loops Studio JUCE engine modularization.
// Generated: 2026-03-03
// NOTE: main.cpp is intentionally NOT included (already exists).
// These files are placeholders with TODOs and interface notes.

#pragma once
#include <memory>
#include <string>
#include <vector>
#include "FxBase.h"

/*
  FxChain
  =======
  Holds an ordered list of FxBase units for one mixer channel.
  Created/updated by IPC op fx.chain.set.
*/

class FxFactory;

class FxChain {
public:
  FxChain();
  ~FxChain();

  void prepare(double sampleRate, int maxBlockSize, int numChannels);

  void setChain(FxFactory& factory, const std::vector<std::string>& typesOrdered);
  void setParam(int fxIndex, const std::string& name, float value);
  void setBypass(int fxIndex, bool bypass);

  void process(float** chans, int numChannels, int numFrames, double bpm, int64_t samplePos, bool playing);

  int size() const { return (int)mFx.size(); }

private:
  double mSampleRate = 44100.0;
  int mMaxBlock = 512;
  int mNumCh = 2;

  std::vector<std::unique_ptr<FxBase>> mFx;
};
