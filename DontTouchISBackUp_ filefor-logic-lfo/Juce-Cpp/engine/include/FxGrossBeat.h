#pragma once
#include "FxBase.h"
#include <array>
#include <atomic>
#include <juce_audio_basics/juce_audio_basics.h>
#include <vector>

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
  static int parseDivision(const std::string& div);
  static float hpAlpha25Hz(float sampleRate);
  static float computeGateTarget(float g01, float depth, float curvePow, float epsilon);

public:
  void setDivision(const std::string& div);
  void setPattern(const std::vector<float>& values);

private:
  static constexpr int kMaxPatternSteps = 64;

  double mSampleRate = 44100.0;
  int mMaxBlock = 512;
  int mNumCh = 2;

  std::atomic<float> pWet { 1.0f };
  std::atomic<float> pSmoothSec { 0.03f };
  std::atomic<float> pDepth { 1.0f };
  std::atomic<float> pCurvePow { 1.7f };
  std::atomic<float> pEpsilon { 0.01f };
  std::atomic<int> pDivision { 16 };

  std::array<std::atomic<float>, kMaxPatternSteps> pPattern {};

  juce::SmoothedValue<float> wetSmoothed;
  float mGateSmoothed = 1.0f;

  float mPrevInL = 0.0f;
  float mPrevInR = 0.0f;
  float mPrevOutL = 0.0f;
  float mPrevOutR = 0.0f;
};
