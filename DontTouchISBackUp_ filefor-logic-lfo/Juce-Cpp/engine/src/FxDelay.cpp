#include "FxDelay.h"
#include <algorithm>

static inline bool _isFinite(float x) { return std::isfinite((double)x); }

int FxDelay::parseDivision(const std::string& div) {
  // expects "1:8" etc, but tolerates "8"
  int denom = 0;
  auto pos = div.find(':');
  try {
    if (pos != std::string::npos) denom = std::stoi(div.substr(pos + 1));
    else denom = std::stoi(div);
  } catch (...) { denom = 8; }

  switch (denom) {
    case 2: case 3: case 4: case 6: case 8: case 16: return denom;
    default: return 8;
  }
}

float FxDelay::delayTimeFromDivision(float bpm, int denom) {
  bpm = std::max(1.0f, bpm);
  const float beat = 60.0f / bpm;   // quarter note
  const float whole = beat * 4.0f;
  denom = std::max(1, denom);
  return whole / (float)denom;
}

float FxDelay::onePoleAlphaFromCutoff(float cutoffHz, float sampleRate) {
  cutoffHz = std::clamp(cutoffHz, 20.0f, 20000.0f);
  sampleRate = std::max(1.0f, sampleRate);
  const float x = -2.0f * 3.14159265358979323846f * cutoffHz / sampleRate;
  return 1.0f - std::exp(x);
}

void FxDelay::prepare(double sampleRate, int maxBlockSize, int numChannels) {
  mSampleRate = (sampleRate > 0.0 ? sampleRate : 44100.0);
  mMaxBlock = std::max(64, maxBlockSize);
  mNumCh = std::max(1, numChannels);

  const double maxDelaySec = 2.0;
  const int ringN = (int)std::ceil(maxDelaySec * mSampleRate) + 4;
  mRingL.assign((size_t)ringN, 0.0f);
  mRingR.assign((size_t)ringN, 0.0f);

  constexpr double rampSec = 0.01;
  wetSmoothed.reset(mSampleRate, rampSec);
  feedbackSmoothed.reset(mSampleRate, rampSec);
  timeSecSmoothed.reset(mSampleRate, rampSec);
  wetSmoothed.setCurrentAndTargetValue(std::clamp(pWet.load(std::memory_order_relaxed), 0.0f, 1.0f));
  feedbackSmoothed.setCurrentAndTargetValue(std::clamp(pFeedback.load(std::memory_order_relaxed), 0.0f, 0.95f));
  float ts = pTimeSec.load(std::memory_order_relaxed);
  if (!(ts > 0.0f)) ts = 0.25f;
  timeSecSmoothed.setCurrentAndTargetValue(std::clamp(ts, 0.01f, 1.99f));

  reset();
}

void FxDelay::reset() {
  std::fill(mRingL.begin(), mRingL.end(), 0.0f);
  std::fill(mRingR.begin(), mRingR.end(), 0.0f);
  mIdx = 0;
  mDampStateL = 0.0f;
  mDampStateR = 0.0f;
}

void FxDelay::setDivision(const std::string& div) {
  pDenom.store(parseDivision(div), std::memory_order_relaxed);
  // ensure tempo sync is active if time wasn't explicitly set
  // (we keep pTimeSec as-is; user can override by setting time > 0)
}

void FxDelay::setParam(const std::string& name, float value) {
  // Control-thread only
  if (name == "wet" || name == "mix") {
    const float wet = std::clamp(value, 0.0f, 1.0f);
    pWet.store(wet, std::memory_order_relaxed);
    wetSmoothed.setTargetValue(wet);
  }
  else if (name == "feedback") {
    const float fb = std::clamp(value, 0.0f, 0.95f);
    pFeedback.store(fb, std::memory_order_relaxed);
    feedbackSmoothed.setTargetValue(fb);
  }
  else if (name == "time" || name == "timeSec") {
    pTimeSec.store(value, std::memory_order_relaxed);
    if (value > 0.0f)
      timeSecSmoothed.setTargetValue(std::clamp(value, 0.01f, 1.99f));
  }
  else if (name == "damp" || name == "dampHz") pDampHz.store(value, std::memory_order_relaxed);
  else if (name == "division" || name == "rate") {
    // some UIs may send numeric denom; tolerate that
    int denom = (int)std::lround(std::max(1.0f, value));
    pDenom.store(parseDivision(std::to_string(denom)), std::memory_order_relaxed);
  }
}

void FxDelay::process(float** chans, int numChannels, int numFrames,
                      double bpm, int64_t /*samplePos*/, bool /*playing*/) {
  if (!chans || numFrames <= 0) return;
  if (mBypass) return;

  const int chCount = std::min(numChannels, 2);
  if (chCount < 1) return;

  wetSmoothed.setTargetValue(std::clamp(pWet.load(std::memory_order_relaxed), 0.0f, 1.0f));
  feedbackSmoothed.setTargetValue(std::clamp(pFeedback.load(std::memory_order_relaxed), 0.0f, 0.95f));

  const float dampHz = pDampHz.load(std::memory_order_relaxed);
  const float alpha = onePoleAlphaFromCutoff(dampHz, (float)mSampleRate);

  float tSecTarget = pTimeSec.load(std::memory_order_relaxed);
  if (!(tSecTarget > 0.0f)) {
    const int denom = std::max(1, pDenom.load(std::memory_order_relaxed));
    tSecTarget = delayTimeFromDivision((float)bpm, denom);
  }
  timeSecSmoothed.setTargetValue(std::clamp(tSecTarget, 0.01f, 1.99f));

  const int ringN = (int)mRingL.size();
  if (ringN < 8) return;

  for (int i = 0; i < numFrames; ++i) {
    const float wet = wetSmoothed.getNextValue();
    const float dry = 1.0f - wet;
    float fb = feedbackSmoothed.getNextValue();
    const float tSec = timeSecSmoothed.getNextValue();
    int delaySamp = (int)std::llround(tSec * (float)mSampleRate);
    delaySamp = std::clamp(delaySamp, 1, ringN - 1);
    float l = chans[0] ? chans[0][i] : 0.0f;
    float r = (chCount > 1 && chans[1]) ? chans[1][i] : l;

    // guard inputs
    if (!_isFinite(l)) l = 0.0f;
    if (!_isFinite(r)) r = 0.0f;

    int ridx = mIdx - delaySamp;
    if (ridx < 0) ridx += ringN;

    const float dlIn = mRingL[(size_t)ridx];
    const float drIn = mRingR[(size_t)ridx];

    // damping in feedback path
    mDampStateL = mDampStateL + alpha * (dlIn - mDampStateL);
    mDampStateR = mDampStateR + alpha * (drIn - mDampStateR);
    float dl = mDampStateL;
    float dr = mDampStateR;

    if (!_isFinite(dl)) dl = 0.0f;
    if (!_isFinite(dr)) dr = 0.0f;

    // feedback write
    float wl = l + dl * fb;
    float wr = r + dr * fb;

    if (!_isFinite(wl) || !_isFinite(wr)) {
      // kill runaway
      reset();
      wl = l;
      wr = r;
      dl = 0.0f;
      dr = 0.0f;
      fb = 0.0f;
    }

    mRingL[(size_t)mIdx] = wl;
    mRingR[(size_t)mIdx] = wr;

    // mix output
    float outL = l * dry + dl * wet;
    float outR = r * dry + dr * wet;

    if (!_isFinite(outL) || !_isFinite(outR)) {
      outL = 0.0f; outR = 0.0f;
      reset();
    }

    if (chans[0]) chans[0][i] = outL;
    if (chCount > 1 && chans[1]) chans[1][i] = outR;

    mIdx++;
    if (mIdx >= ringN) mIdx = 0;
  }
}
