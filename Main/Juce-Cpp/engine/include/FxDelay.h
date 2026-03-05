#pragma once
#include "FxBase.h"
#include <atomic>
#include <string>
#include <vector>
#include <cmath>
#include <juce_audio_basics/juce_audio_basics.h>

/*
  FxDelay (JUCE)
  -------------
  Port from fx_delay.js (WebAudio prototype):
  - delay line + feedback
  - wet/dry mix (wet or mix)
  - optional damping lowpass in feedback path (damp Hz)
  - tempo sync using division strings (e.g., "1:8", "1:6", etc.)
  - "time" (seconds) overrides tempo sync when > 0
*/

class FxDelay final : public FxBase {
public:
  const char* type() const override { return "delay"; }

  void prepare(double sampleRate, int maxBlockSize, int numChannels) override;
  void setParam(const std::string& name, float value) override;
  void process(float** chans, int numChannels, int numFrames,
               double bpm, int64_t samplePos, bool playing) override;

  // For string parameters coming from IPC (division/rate).
  void setDivision(const std::string& div);

  // Fast path used by main.cpp (sample-by-sample).
  inline void processSample(float& l, float& r, double bpm) {
    float in[2] = { l, r };
    float* chans[2] = { &in[0], &in[1] };
    process(chans, 2, 1, bpm, 0, true);
    l = in[0]; r = in[1];
  }

  void reset();

private:
  static int parseDivision(const std::string& div);     // returns denom (2,3,4,6,8,16)
  static float delayTimeFromDivision(float bpm, int denom);
  static float onePoleAlphaFromCutoff(float cutoffHz, float sampleRate);

private:
  double mSampleRate = 44100.0;
  int mMaxBlock = 512;
  int mNumCh = 2;

  // ring buffers per instance (2.0 seconds max)
  std::vector<float> mRingL;
  std::vector<float> mRingR;
  int mIdx = 0;

  // states
  float mDampStateL = 0.0f;
  float mDampStateR = 0.0f;

  // params (control thread -> audio thread)
  std::atomic<float> pWet { 0.25f };
  std::atomic<float> pFeedback { 0.35f };
  std::atomic<float> pTimeSec { -1.0f };      // if >0 => override tempo sync
  std::atomic<float> pDampHz { 12000.0f };
  std::atomic<int>   pDenom { 8 };            // division denom for tempo sync (1:denom)

  juce::SmoothedValue<float> wetSmoothed;
  juce::SmoothedValue<float> feedbackSmoothed;
  juce::SmoothedValue<float> timeSecSmoothed;
};
