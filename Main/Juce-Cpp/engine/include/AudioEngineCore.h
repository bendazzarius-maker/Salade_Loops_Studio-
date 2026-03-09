#pragma once
#include <cstdint>
#include <vector>
#include <juce_core/juce_core.h>
#include "AudioScheduler.h"
#include "LfoCurveEngine.h"
#include "LfoPresetEngine.h"
#include "MixerEngine.h"
#include "ModMatrix.h"

/*
  AudioEngineCore
  ===============
  Central orchestration layer meant to shrink main.cpp.
  main.cpp becomes bootstrap + IPC pump, while this class owns the audio-facing
  modules and advances them coherently per block.
*/

class AudioEngineCore {
public:
  AudioEngineCore();
  ~AudioEngineCore();

  void prepare(double sampleRate, int maxBlockSize, int numOutChannels, int numMixerChannels);
  void reset();

  void setTransport(double bpm, int64_t samplePos, bool playing);
  void setTimeline(const std::vector<ScheduledEvent>& timeline);

  MixerEngine& mixer() noexcept { return mMixer; }
  const MixerEngine& mixer() const noexcept { return mMixer; }

  LfoPresetEngine& presetLfo() noexcept { return mPresetLfo; }
  LfoCurveEngine& curveLfo() noexcept { return mCurveLfo; }
  ModMatrix& modMatrix() noexcept { return mModMatrix; }
  AudioScheduler& scheduler() noexcept { return mScheduler; }

  void process(float** channelInputs, int numMixerChannels, float** masterOutStereo, int numFrames);

private:
  double mSampleRate = 44100.0;
  int mMaxBlockSize = 512;
  int mNumOutChannels = 2;
  int mNumMixerChannels = 0;

  MixerEngine mMixer;
  LfoPresetEngine mPresetLfo;
  LfoCurveEngine mCurveLfo;
  ModMatrix mModMatrix;
  AudioScheduler mScheduler;
};
