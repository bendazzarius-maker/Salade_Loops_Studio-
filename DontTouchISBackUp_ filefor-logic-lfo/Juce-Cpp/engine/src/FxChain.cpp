// Skeleton files generated for Salad Loops Studio JUCE engine modularization.
// Generated: 2026-03-03
// NOTE: main.cpp is intentionally NOT included (already exists).
// These files are placeholders with TODOs and interface notes.

#include "FxChain.h"
#include "FxFactory.h"

FxChain::FxChain() = default;
FxChain::~FxChain() = default;

void FxChain::prepare(double sampleRate, int maxBlockSize, int numChannels) {
  mSampleRate = sampleRate;
  mMaxBlock = maxBlockSize;
  mNumCh = numChannels;
  for (auto& fx : mFx) fx->prepare(sampleRate, maxBlockSize, numChannels);
}

void FxChain::setChain(FxFactory& factory, const std::vector<std::string>& typesOrdered) {
  // TODO: rebuild chain to match typesOrdered.
  // Keep params if possible (by type + index), otherwise reset.
  (void)factory; (void)typesOrdered;
}

void FxChain::setParam(int fxIndex, const std::string& name, float value) {
  if (fxIndex < 0 || fxIndex >= (int)mFx.size()) return;
  mFx[(size_t)fxIndex]->setParam(name, value);
}

void FxChain::setBypass(int fxIndex, bool bypass) {
  if (fxIndex < 0 || fxIndex >= (int)mFx.size()) return;
  mFx[(size_t)fxIndex]->setBypass(bypass);
}

void FxChain::process(float** chans, int numChannels, int numFrames, double bpm, int64_t samplePos, bool playing) {
  (void)numChannels;
  for (auto& fx : mFx) {
    if (!fx || fx->isBypassed()) continue;
    fx->process(chans, mNumCh, numFrames, bpm, samplePos, playing);
  }
}
