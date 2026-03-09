#include "FxGrossBeat.h"
#include <algorithm>
#include <cmath>

static inline bool _isFiniteGb(float x) { return std::isfinite((double)x); }

int FxGrossBeat::parseDivision(const std::string& div) {
  int denom = 0;
  auto pos = div.find(':');
  try {
    if (pos != std::string::npos) denom = std::stoi(div.substr(pos + 1));
    else denom = std::stoi(div);
  } catch (...) { denom = 16; }

  switch (denom) {
    case 2: case 3: case 4: case 6: case 8: case 16: case 32: case 64: return denom;
    default: return 16;
  }
}

float FxGrossBeat::hpAlpha25Hz(float sampleRate) {
  sampleRate = std::max(1.0f, sampleRate);
  const float dt = 1.0f / sampleRate;
  const float rc = 1.0f / (2.0f * 3.14159265358979323846f * 25.0f);
  return rc / (rc + dt);
}

float FxGrossBeat::computeGateTarget(float g01, float depth, float curvePow, float epsilon) {
  const float shaped = std::pow(std::clamp(g01, 0.0f, 1.0f), std::max(0.01f, curvePow));
  const float g = (1.0f - depth) + depth * shaped;
  return std::max(epsilon, g);
}

void FxGrossBeat::prepare(double sampleRate, int maxBlockSize, int numChannels) {
  mSampleRate = sampleRate > 0.0 ? sampleRate : 44100.0;
  mMaxBlock = std::max(64, maxBlockSize);
  mNumCh = std::max(1, numChannels);

  wetSmoothed.reset(mSampleRate, 0.01);
  wetSmoothed.setCurrentAndTargetValue(std::clamp(pWet.load(std::memory_order_relaxed), 0.0f, 1.0f));

  mPrevInL = mPrevInR = 0.0f;
  mPrevOutL = mPrevOutR = 0.0f;
  mGateSmoothed = 1.0f;

  const int div = std::clamp(pDivision.load(std::memory_order_relaxed), 1, kMaxPatternSteps);
  for (int i = 0; i < kMaxPatternSteps; ++i) {
    const float def = (i < div) ? 1.0f : 0.0f;
    pPattern[(size_t)i].store(def, std::memory_order_relaxed);
  }
}

void FxGrossBeat::setDivision(const std::string& div) {
  const int denom = std::clamp(parseDivision(div), 1, kMaxPatternSteps);
  pDivision.store(denom, std::memory_order_relaxed);
}

void FxGrossBeat::setPattern(const std::vector<float>& values) {
  const int div = std::clamp(pDivision.load(std::memory_order_relaxed), 1, kMaxPatternSteps);
  if (values.empty()) {
    for (int i = 0; i < div; ++i) pPattern[(size_t)i].store(1.0f, std::memory_order_relaxed);
    return;
  }

  for (int i = 0; i < div; ++i) {
    const float v = values[(size_t)(i % (int)values.size())];
    pPattern[(size_t)i].store(v >= 0.5f ? 1.0f : 0.0f, std::memory_order_relaxed);
  }
}

void FxGrossBeat::setParam(const std::string& name, float value) {
  if (name == "wet" || name == "mix") {
    const float wet = std::clamp(value, 0.0f, 1.0f);
    pWet.store(wet, std::memory_order_relaxed);
    wetSmoothed.setTargetValue(wet);
  }
  else if (name == "smooth") {
    pSmoothSec.store(std::clamp(value, 0.008f, 0.10f), std::memory_order_relaxed);
  }
  else if (name == "depth") {
    pDepth.store(std::clamp(value, 0.0f, 1.0f), std::memory_order_relaxed);
  }
  else if (name == "curve" || name == "curvePow") {
    pCurvePow.store(std::clamp(value, 0.6f, 4.0f), std::memory_order_relaxed);
  }
  else if (name == "epsilon") {
    pEpsilon.store(std::clamp(value, 0.001f, 0.05f), std::memory_order_relaxed);
  }
  else if (name == "division" || name == "rate") {
    const int denom = (int)std::lround(std::max(1.0f, value));
    setDivision(std::to_string(denom));
  }
  else if (name.rfind("pattern.", 0) == 0) {
    const size_t dot = name.find('.');
    if (dot != std::string::npos && dot + 1 < name.size()) {
      try {
        const int idx = std::stoi(name.substr(dot + 1));
        const int div = std::clamp(pDivision.load(std::memory_order_relaxed), 1, kMaxPatternSteps);
        if (idx >= 0 && idx < div) {
          pPattern[(size_t)idx].store(value >= 0.5f ? 1.0f : 0.0f, std::memory_order_relaxed);
        }
      } catch (...) {}
    }
  }
}

void FxGrossBeat::process(float** chans, int numChannels, int numFrames, double bpm, int64_t samplePos, bool playing) {
  if (!chans || numFrames <= 0) return;
  if (mBypass) return;

  const int chCount = std::max(1, std::min(numChannels, 2));
  wetSmoothed.setTargetValue(std::clamp(pWet.load(std::memory_order_relaxed), 0.0f, 1.0f));

  const int denom = std::clamp(pDivision.load(std::memory_order_relaxed), 1, kMaxPatternSteps);

  const float bpmSafe = std::max(1.0f, (float)bpm);
  const float barSec = (60.0f / bpmSafe) * 4.0f;
  const float stepSec = barSec / (float)denom;
  const float stepSamples = std::max(1.0f, stepSec * (float)mSampleRate);

  const float smoothSec = std::clamp(pSmoothSec.load(std::memory_order_relaxed), 0.008f, 0.10f);
  const float tc = std::max(0.005f, smoothSec / 2.0f);
  const float gateAlpha = 1.0f - std::exp(-1.0f / std::max(1.0f, tc * (float)mSampleRate));

  const float depth = std::clamp(pDepth.load(std::memory_order_relaxed), 0.0f, 1.0f);
  const float curvePow = std::clamp(pCurvePow.load(std::memory_order_relaxed), 0.6f, 4.0f);
  const float epsilon = std::clamp(pEpsilon.load(std::memory_order_relaxed), 0.001f, 0.05f);

  const float hpA = hpAlpha25Hz((float)mSampleRate);

  for (int i = 0; i < numFrames; ++i) {
    float inL = chans[0] ? chans[0][i] : 0.0f;
    float inR = (chCount > 1 && chans[1]) ? chans[1][i] : inL;

    if (!_isFiniteGb(inL)) inL = 0.0f;
    if (!_isFiniteGb(inR)) inR = 0.0f;

    const int64_t sAbs = samplePos + (int64_t)i;
    const int64_t stepK = (int64_t)std::floor((double)sAbs / (double)stepSamples);
    int idx = (int)(stepK % (int64_t)denom);
    if (idx < 0) idx += denom;

    const float g01 = pPattern[(size_t)idx].load(std::memory_order_relaxed) >= 0.5f ? 1.0f : 0.0f;
    const float gateTarget = playing ? computeGateTarget(g01, depth, curvePow, epsilon) : 1.0f;
    mGateSmoothed += gateAlpha * (gateTarget - mGateSmoothed);

    const float hpL = hpA * (mPrevOutL + inL - mPrevInL);
    const float hpR = hpA * (mPrevOutR + inR - mPrevInR);
    mPrevInL = inL;  mPrevInR = inR;
    mPrevOutL = hpL; mPrevOutR = hpR;

    const float wet = wetSmoothed.getNextValue();
    const float dry = 1.0f - wet;

    float outL = inL * dry + (hpL * mGateSmoothed) * wet;
    float outR = inR * dry + (hpR * mGateSmoothed) * wet;

    if (!_isFiniteGb(outL) || !_isFiniteGb(outR)) {
      outL = inL;
      outR = inR;
      mGateSmoothed = 1.0f;
      mPrevInL = mPrevInR = mPrevOutL = mPrevOutR = 0.0f;
    }

    if (chans[0]) chans[0][i] = outL;
    if (chCount > 1 && chans[1]) chans[1][i] = outR;
  }
}
