#include "instruments/SampleTouskiRuntime.h"

#include <cmath>

namespace sls::inst {
namespace {
constexpr float kPiF = 3.14159265358979323846f;

inline double wrapLoopPositionShared(double pos, int loopStart, int loopEnd) noexcept {
  if (loopEnd <= loopStart) return pos;
  const double loopLen = (double) (loopEnd - loopStart);
  while (pos >= (double) loopEnd) pos -= loopLen;
  while (pos < (double) loopStart) pos += loopLen;
  return pos;
}

inline float hermiteSampleShared(const juce::AudioBuffer<float>& b, int ch, double pos) noexcept {
  const int n = b.getNumSamples();
  if (n <= 0) return 0.0f;

  const double safePos = juce::jlimit(0.0, (double) std::max(0, n - 1), pos);
  const int i1 = juce::jlimit(0, n - 1, (int) std::floor(safePos));
  const float t = (float) (safePos - (double) i1);

  const int i0 = juce::jlimit(0, n - 1, i1 - 1);
  const int i2 = juce::jlimit(0, n - 1, i1 + 1);
  const int i3 = juce::jlimit(0, n - 1, i1 + 2);

  const float y0 = b.getSample(ch, i0);
  const float y1 = b.getSample(ch, i1);
  const float y2 = b.getSample(ch, i2);
  const float y3 = b.getSample(ch, i3);

  const float c0 = y1;
  const float c1 = 0.5f * (y2 - y0);
  const float c2 = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
  const float c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + c0;
}

inline float equalPowerFadeInShared(double t) noexcept {
  t = juce::jlimit(0.0, 1.0, t);
  return std::sin((float) t * (kPiF * 0.5f));
}

inline float equalPowerFadeOutShared(double t) noexcept {
  t = juce::jlimit(0.0, 1.0, t);
  return std::cos((float) t * (kPiF * 0.5f));
}

inline double seamErrorShared(const juce::AudioBuffer<float>& buffer,
                              int loopStart,
                              int loopEnd,
                              int window) noexcept {
  const int channels = std::max(1, std::min(2, buffer.getNumChannels()));
  window = std::max(4, window);
  if (loopEnd - loopStart <= window + 2)
    return std::numeric_limits<double>::max();

  const int stride = (window > 1024) ? 4 : (window > 384 ? 2 : 1);
  double err = 0.0;
  int count = 0;

  for (int ch = 0; ch < channels; ++ch) {
    const auto* rd = buffer.getReadPointer(ch);
    for (int i = 0; i < window; i += stride) {
      const float tail = rd[loopEnd - window + i];
      const float head = rd[loopStart + i];
      const double d = (double) tail - (double) head;
      err += d * d;
      ++count;
    }

    const float endA = rd[loopEnd - 2];
    const float endB = rd[loopEnd - 1];
    const float startA = rd[loopStart];
    const float startB = rd[loopStart + 1];
    const double amp = (double) endB - (double) startA;
    const double slope = ((double) endB - (double) endA) - ((double) startB - (double) startA);
    err += amp * amp * 4.0;
    err += slope * slope * 2.0;
  }

  return err / (double) std::max(1, count);
}

inline int refineLoopStartForEnd(const juce::AudioBuffer<float>& buffer,
                                 int targetStart,
                                 int loopEnd,
                                 int searchRadius,
                                 int window,
                                 int minBound,
                                 int maxBound) noexcept {
  int best = juce::jlimit(minBound, maxBound, targetStart);
  double bestScore = seamErrorShared(buffer, best, loopEnd, window);

  const int lo = juce::jlimit(minBound, maxBound, targetStart - searchRadius);
  const int hi = juce::jlimit(minBound, maxBound, targetStart + searchRadius);
  for (int start = lo; start <= hi; ++start) {
    if (loopEnd - start <= window + 2) continue;
    const double score = seamErrorShared(buffer, start, loopEnd, window);
    if (score < bestScore) {
      bestScore = score;
      best = start;
    }
  }
  return best;
}

inline int refineLoopEndForStart(const juce::AudioBuffer<float>& buffer,
                                 int loopStart,
                                 int targetEnd,
                                 int searchRadius,
                                 int window,
                                 int minBound,
                                 int maxBound) noexcept {
  int best = juce::jlimit(minBound, maxBound, targetEnd);
  double bestScore = seamErrorShared(buffer, loopStart, best, window);

  const int lo = juce::jlimit(minBound, maxBound, targetEnd - searchRadius);
  const int hi = juce::jlimit(minBound, maxBound, targetEnd + searchRadius);
  for (int end = lo; end <= hi; ++end) {
    if (end - loopStart <= window + 2) continue;
    const double score = seamErrorShared(buffer, loopStart, end, window);
    if (score < bestScore) {
      bestScore = score;
      best = end;
    }
  }
  return best;
}

inline float sampleLoopedSeamless(const juce::AudioBuffer<float>& buffer,
                                  int channel,
                                  double pos,
                                  int loopStart,
                                  int loopEnd,
                                  int crossfadeSamples) noexcept {
  if (buffer.getNumSamples() <= 1)
    return 0.0f;

  const double wrappedPos = wrapLoopPositionShared(pos, loopStart, loopEnd);
  if (loopEnd <= loopStart || crossfadeSamples <= 0)
    return hermiteSampleShared(buffer, channel, wrappedPos);

  const int loopLen = std::max(1, loopEnd - loopStart);
  const int xfade = std::min(std::max(1, crossfadeSamples), std::max(1, loopLen - 4));
  const double xfadeStart = (double) loopEnd - (double) xfade;

  if (wrappedPos >= xfadeStart && wrappedPos < (double) loopEnd) {
    const double t = (wrappedPos - xfadeStart) / std::max(1.0, (double) xfade);
    const double headPos = (double) loopStart + (wrappedPos - xfadeStart);
    const float tail = hermiteSampleShared(buffer, channel, wrappedPos);
    const float head = hermiteSampleShared(buffer, channel, headPos);
    return tail * equalPowerFadeOutShared(t) + head * equalPowerFadeInShared(t);
  }

  return hermiteSampleShared(buffer, channel, wrappedPos);
}

inline int clampLoopInteriorShared(int pos, int loopStart, int loopEnd, int guard) noexcept {
  const int minPos = std::min(loopEnd - 1, loopStart + std::max(0, guard));
  const int maxPos = std::max(minPos, loopEnd - 1 - std::max(0, guard));
  return juce::jlimit(minPos, maxPos, pos);
}

inline double grainEntryCostShared(const juce::AudioBuffer<float>& buffer,
                                   int pos,
                                   int loopStart,
                                   int loopEnd) noexcept {
  if (buffer.getNumSamples() <= 4 || loopEnd - loopStart <= 4)
    return 0.0;

  const int rch = (buffer.getNumChannels() > 1) ? 1 : 0;
  const int safePos = clampLoopInteriorShared(pos, loopStart, loopEnd, 2);
  double cost = 0.0;

  for (int ch = 0; ch <= rch; ++ch) {
    const float a = hermiteSampleShared(buffer, ch, (double) safePos - 1.0);
    const float b = hermiteSampleShared(buffer, ch, (double) safePos);
    const float c = hermiteSampleShared(buffer, ch, (double) safePos + 1.0);
    const double amp = std::abs((double) b);
    const double slope = std::abs((double) c - (double) a);
    cost += amp * 0.7 + slope * 0.3;
  }

  return cost;
}
inline double grainMaxReadableDurationShared(int loopStart,
                                            int loopEnd,
                                            int guard,
                                            double step) noexcept {
  const int available = std::max(0, loopEnd - loopStart - 2 * std::max(0, guard));
  if (available <= 2)
    return 0.0;
  return std::max(1.0, ((double) available - 2.0) / std::max(0.0001, step));
}

inline int grainMaxStartShared(int loopStart,
                               int loopEnd,
                               int guard,
                               int duration,
                               double step) noexcept {
  const double travel = std::max(0.0, ((double) std::max(1, duration) - 1.0) * std::max(0.0001, step));
  const int maxStart = (int) std::floor((double) (loopEnd - std::max(1, guard) - 2) - travel);
  return std::max(loopStart + std::max(1, guard), maxStart);
}

}

// ------------------------------ ResampleHoldEngine ------------------------------

void ResampleHoldEngine::initialise(State& state,
                                    int start,
                                    int loopStart,
                                    int loopEnd,
                                    int end,
                                    double rate,
                                    bool loopEnabled,
                                    int crossfadeSamples) noexcept {
  state.pos = (double) start;
  state.rate = std::max(0.0001, rate);
  state.start = start;
  state.loopStart = loopStart;
  state.loopEnd = loopEnd;
  state.end = end;
  state.loopEnabled = loopEnabled && loopEnd > loopStart;
  state.crossfadeSamples = std::max(0, crossfadeSamples);
}

void ResampleHoldEngine::enterRelease(State& state, int end) noexcept {
  state.loopEnabled = false;
  state.end = std::max(end, state.loopEnd);
}

int ResampleHoldEngine::currentSourceIndex(const State& state) noexcept {
  return (int) std::floor(state.pos);
}

float ResampleHoldEngine::sampleAtHermite(const juce::AudioBuffer<float>& b, int ch, double pos) noexcept {
  return hermiteSampleShared(b, ch, pos);
}

double ResampleHoldEngine::wrapLoopPosition(double pos, int loopStart, int loopEnd) noexcept {
  return wrapLoopPositionShared(pos, loopStart, loopEnd);
}

float ResampleHoldEngine::hannFadeIn(double t) noexcept {
  return equalPowerFadeInShared(t);
}

float ResampleHoldEngine::hannFadeOut(double t) noexcept {
  return equalPowerFadeOutShared(t);
}

ResampleHoldEngine::RenderResult ResampleHoldEngine::renderFrame(const State& state,
                                                                 const juce::AudioBuffer<float>& buffer) noexcept {
  RenderResult rr;

  if (buffer.getNumSamples() <= 1 || state.pos >= (double) state.end || state.pos >= (double) (buffer.getNumSamples() - 1)) {
    rr.finished = true;
    return rr;
  }

  const int rch = (buffer.getNumChannels() > 1) ? 1 : 0;

  if (state.loopEnabled && state.loopEnd > state.loopStart) {
    rr.frame.left = sampleLoopedSeamless(buffer, 0, state.pos, state.loopStart, state.loopEnd, state.crossfadeSamples);
    rr.frame.right = sampleLoopedSeamless(buffer, rch, state.pos, state.loopStart, state.loopEnd, state.crossfadeSamples);
    return rr;
  }

  rr.frame.left = sampleAtHermite(buffer, 0, state.pos);
  rr.frame.right = sampleAtHermite(buffer, rch, state.pos);
  return rr;
}

void ResampleHoldEngine::advance(State& state) noexcept {
  state.pos += state.rate;
  if (state.loopEnabled && state.loopEnd > state.loopStart && state.pos >= (double) state.loopEnd)
    state.pos = wrapLoopPosition(state.pos, state.loopStart, state.loopEnd);
}

// ------------------------------ GranularHoldEngine ------------------------------

void GranularHoldEngine::initialise(State& state,
                                    int loopStart,
                                    int loopEnd,
                                    double pitchRatio,
                                    int grainLengthSamples,
                                    int hopSamples,
                                    int crossfadeSamples,
                                    int jitterSamples,
                                    float seamDiffuse,
                                    std::uint32_t seed) noexcept {
  state.prepared = true;
  state.pitchRatio = std::max(0.125, pitchRatio);
  state.loopStart = loopStart;
  state.loopEnd = std::max(loopStart + 1, loopEnd);

  const int loopLen = std::max(32, state.loopEnd - state.loopStart);
  const int guard = std::min(std::max(2, crossfadeSamples / 2), std::max(2, loopLen / 8));
  const double maxReadableDuration = grainMaxReadableDurationShared(state.loopStart, state.loopEnd, guard, state.pitchRatio);
  const int maxGrainLength = std::max(16, (int) std::floor(maxReadableDuration));
  state.grainLength = juce::jlimit(16, std::max(16, maxGrainLength), grainLengthSamples);
  const double requestedHopRatio = juce::jlimit(0.05, 0.95,
                                                (double) std::max(1, hopSamples) / (double) std::max(1, grainLengthSamples));
  const int scaledHop = std::max(4, (int) std::llround((double) state.grainLength * requestedHopRatio));
  state.hopSamples = juce::jlimit(4, std::max(4, state.grainLength - 1), scaledHop);
  state.analysisHop = std::max(1.0, (double) state.hopSamples);
  state.scanDirection = 1.0;
  const int minStart = state.loopStart + guard;
  const int maxStart = grainMaxStartShared(state.loopStart, state.loopEnd, guard, state.grainLength, state.pitchRatio);
  state.lastSpawnStart = (double) minStart;
  state.nextSourceStart = (double) juce::jlimit(minStart, std::max(minStart, maxStart), minStart + std::max(0, (maxStart - minStart) / 8));
  state.samplesUntilSpawn = 0;
  state.crossfadeSamples = std::max(0, crossfadeSamples);
  state.jitterSamples = std::max(0, jitterSamples);
  state.seamDiffuse = juce::jlimit(0.0f, 1.0f, seamDiffuse);
  state.rngState = (seed != 0u) ? seed : 0x9e3779b9u;

  for (auto& grain : state.grains)
    grain = {};
}

int GranularHoldEngine::currentSourceIndex(const State& state) noexcept {
  for (const auto& grain : state.grains) {
    if (grain.active)
      return (int) std::floor(std::min(grain.sourceEnd, grain.sourceStart + (double) grain.age * grain.step));
  }
  return (int) std::floor(state.nextSourceStart);
}

float GranularHoldEngine::sampleAtHermite(const juce::AudioBuffer<float>& b, int ch, double pos) noexcept {
  return hermiteSampleShared(b, ch, pos);
}

double GranularHoldEngine::wrapLoopPosition(double pos, int loopStart, int loopEnd) noexcept {
  return wrapLoopPositionShared(pos, loopStart, loopEnd);
}

float GranularHoldEngine::hannWindow(int age, int duration) noexcept {
  if (duration <= 1) return 1.0f;
  const float t = (float) age / (float) std::max(1, duration - 1);
  return 0.5f - 0.5f * std::cos(t * kPiF);
}

float GranularHoldEngine::nextRandomSigned(State& state) noexcept {
  std::uint32_t x = state.rngState;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  state.rngState = x;
  const float unit = (float) (x & 0x00ffffffu) / 16777215.0f;
  return unit * 2.0f - 1.0f;
}

int GranularHoldEngine::chooseGrainStart(const State& state,
                                         const juce::AudioBuffer<float>& buffer,
                                         int predictedStart) noexcept {
  const int loopLen = std::max(8, state.loopEnd - state.loopStart);
  const int guard = std::min(std::max(2, state.crossfadeSamples / 2), std::max(2, loopLen / 8));
  const int maxRadius = std::max(0, std::min({ state.jitterSamples, std::max(0, loopLen / 6), std::max(0, state.grainLength / 4) }));
  const int minStart = state.loopStart + guard;
  const int maxStart = grainMaxStartShared(state.loopStart, state.loopEnd, guard, state.grainLength, state.pitchRatio);
  if (maxStart <= minStart)
    return minStart;

  const int center = juce::jlimit(minStart, maxStart, predictedStart);
  if (maxRadius <= 0)
    return center;

  const int lo = juce::jlimit(minStart, maxStart, center - maxRadius);
  const int hi = juce::jlimit(minStart, maxStart, center + maxRadius);
  const int stride = (maxRadius > 96) ? 4 : (maxRadius > 32 ? 2 : 1);

  int best = center;
  double bestCost = std::numeric_limits<double>::max();
  for (int pos = lo; pos <= hi; pos += stride) {
    const double localCost = grainEntryCostShared(buffer, pos, state.loopStart, state.loopEnd);
    const double proximity = (double) std::abs(pos - center) / (double) std::max(1, maxRadius);
    const double score = localCost + proximity * (1.0 - 0.65 * (double) state.seamDiffuse);
    if (score < bestCost) {
      bestCost = score;
      best = pos;
    }
  }
  return best;
}

void GranularHoldEngine::spawnGrain(State& state, const juce::AudioBuffer<float>& buffer) noexcept {
  const int loopLen = std::max(8, state.loopEnd - state.loopStart);
  const int guard = std::min(std::max(2, state.crossfadeSamples / 2), std::max(2, loopLen / 8));
  const int jitterRadius = std::max(0, std::min({ state.jitterSamples, std::max(0, loopLen / 6), std::max(0, state.grainLength / 4) }));
  const double jitter = (double) jitterRadius * (double) state.seamDiffuse * (double) nextRandomSigned(state);
  const int predicted = (int) std::llround(state.nextSourceStart + jitter);
  const int chosen = chooseGrainStart(state, buffer, predicted);

  Grain* slot = nullptr;
  for (auto& grain : state.grains) {
    if (!grain.active) {
      slot = &grain;
      break;
    }
  }
  if (!slot)
    slot = &state.grains[0];

  const double maxDuration = grainMaxReadableDurationShared(chosen, state.loopEnd, guard, state.pitchRatio);
  const int duration = std::max(8, std::min(state.grainLength, (int) std::floor(maxDuration)));
  const double sourceEnd = (double) chosen + ((double) std::max(1, duration) - 1.0) * state.pitchRatio;

  slot->active = true;
  slot->sourceStart = (double) chosen;
  slot->sourceEnd = std::min(sourceEnd, (double) (state.loopEnd - guard - 1));
  slot->step = state.pitchRatio;
  slot->age = 0;
  slot->duration = duration;
  state.lastSpawnStart = slot->sourceStart;

  const int minStart = state.loopStart + guard;
  const int maxStart = grainMaxStartShared(state.loopStart, state.loopEnd, guard, state.grainLength, state.pitchRatio);
  if (maxStart <= minStart) {
    state.nextSourceStart = (double) minStart;
    state.scanDirection = 1.0;
    return;
  }

  const double roam = std::max(1.0, state.analysisHop);
  state.nextSourceStart += roam * state.scanDirection;
  const double loBound = (double) minStart;
  const double hiBound = (double) maxStart;
  if (state.nextSourceStart >= hiBound) {
    state.nextSourceStart = hiBound;
    state.scanDirection = -1.0;
  } else if (state.nextSourceStart <= loBound) {
    state.nextSourceStart = loBound;
    state.scanDirection = 1.0;
  }
}

GranularHoldEngine::StereoFrame GranularHoldEngine::renderFrame(State& state,
                                                                const juce::AudioBuffer<float>& buffer) noexcept {
  StereoFrame out;
  if (!state.prepared || buffer.getNumSamples() <= 1 || state.loopEnd <= state.loopStart)
    return out;

  if (state.samplesUntilSpawn <= 0) {
    spawnGrain(state, buffer);
    state.samplesUntilSpawn = state.hopSamples;
  }
  --state.samplesUntilSpawn;

  const int rch = (buffer.getNumChannels() > 1) ? 1 : 0;
  float sumL = 0.0f;
  float sumR = 0.0f;
  float norm = 0.0f;

  for (auto& grain : state.grains) {
    if (!grain.active) continue;

    const double readPos = grain.sourceStart + (double) grain.age * grain.step;
    if (readPos >= grain.sourceEnd) {
      grain.active = false;
      continue;
    }

    const float w = hannWindow(grain.age, grain.duration);
    sumL += sampleAtHermite(buffer, 0, readPos) * w;
    sumR += sampleAtHermite(buffer, rch, readPos) * w;
    norm += w;

    ++grain.age;
    if (grain.age >= grain.duration)
      grain.active = false;
  }

  if (norm > 0.0001f) {
    out.left = sumL / norm;
    out.right = sumR / norm;
  }
  return out;
}

// ------------------------------ SampleTouskiRuntime ------------------------------

SampleTouskiRuntime::SampleTouskiRuntime(int maxVoices)
    : maxVoices_(juce::jmax(1, maxVoices)) {}

void SampleTouskiRuntime::setSampleRate(double sr) noexcept {
  sampleRate_ = std::max(1.0, sr);
}

double SampleTouskiRuntime::getSampleRate() const noexcept {
  return sampleRate_;
}

void SampleTouskiRuntime::setMaxVoices(int maxVoices) {
  maxVoices_ = juce::jmax(1, maxVoices);
  if ((int) voices_.size() > maxVoices_)
    voices_.resize((size_t) maxVoices_);
}

int SampleTouskiRuntime::getMaxVoices() const noexcept {
  return maxVoices_;
}

const std::vector<SampleTouskiRuntime::Voice>& SampleTouskiRuntime::getVoices() const noexcept {
  return voices_;
}

int SampleTouskiRuntime::getNumActiveVoices() const noexcept {
  int active = 0;
  for (const auto& v : voices_)
    if (v.active) ++active;
  return active;
}

void SampleTouskiRuntime::clear() {
  voices_.clear();
}

void SampleTouskiRuntime::stopAll() noexcept {
  for (auto& voice : voices_)
    voice.active = false;
}

int SampleTouskiRuntime::snapToNearestZeroCrossing(const juce::AudioBuffer<float>& buffer,
                                                   int target,
                                                   int searchRadius,
                                                   int minBound,
                                                   int maxBound) noexcept {
  const int n = buffer.getNumSamples();
  if (n <= 2) return target;

  minBound = juce::jlimit(0, n - 2, minBound);
  maxBound = juce::jlimit(minBound + 1, n - 1, maxBound);
  target = juce::jlimit(minBound, maxBound, target);
  if (searchRadius <= 0) return target;

  const int lo = juce::jlimit(minBound, maxBound, target - searchRadius);
  const int hi = juce::jlimit(minBound, maxBound, target + searchRadius);
  const auto* rd = buffer.getReadPointer(0);

  int best = target;
  float bestScore = std::numeric_limits<float>::max();

  for (int i = lo; i < hi; ++i) {
    const float a = rd[i];
    const float b = rd[i + 1];
    const bool crosses = ((a <= 0.0f && b >= 0.0f) || (a >= 0.0f && b <= 0.0f));
    if (!crosses) continue;

    const float score = std::abs(a) + std::abs(b) + 0.0001f * (float) std::abs(i - target);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }

  return best;
}

bool SampleTouskiRuntime::validateVoiceBoundaries(Voice& voice) noexcept {
  if (!voice.sample) return false;
  const int total = voice.sample->buffer.getNumSamples();
  if (total <= 1) return false;

  voice.start = juce::jlimit(0, total - 1, voice.start);
  voice.loopStart = juce::jlimit(voice.start, total - 1, voice.loopStart);
  voice.loopEnd = juce::jlimit(voice.loopStart + 1, total, std::max(voice.loopStart + 1, voice.loopEnd));
  voice.releaseEnd = juce::jlimit(voice.loopEnd, total, std::max(voice.loopEnd, voice.releaseEnd));
  voice.end = juce::jlimit(voice.start + 1, total, std::max(voice.releaseEnd, voice.end));
  return voice.end > voice.start;
}

bool SampleTouskiRuntime::initialiseVoiceFromSpec(Voice& outVoice,
                                                  const VoiceSpec& spec,
                                                  juce::String* errorMessage) const {
  if (!spec.valid) {
    if (errorMessage) *errorMessage = "Invalid Touski voice spec";
    return false;
  }
  if (!spec.sample) {
    if (errorMessage) *errorMessage = "Touski sample not loaded";
    return false;
  }

  const int total = spec.sample->buffer.getNumSamples();
  if (total <= 1) {
    if (errorMessage) *errorMessage = "Touski sample buffer empty";
    return false;
  }

  outVoice = {};
  outVoice.active = true;
  outVoice.releasing = spec.releasing;
  outVoice.instId = spec.instId;
  outVoice.note = spec.note;
  outVoice.mixCh = juce::jmax(1, spec.mixCh);
  outVoice.sample = spec.sample;
  outVoice.start = (spec.start > 0 || spec.posAction <= 0.0f) ? spec.start : (int) std::floor((double) spec.posAction * total);
  outVoice.loopStart = (spec.loopStart > 0 || spec.posLoopStart <= 0.0f) ? spec.loopStart : (int) std::floor((double) spec.posLoopStart * total);
  outVoice.loopEnd = (spec.loopEnd > 0) ? spec.loopEnd : (int) std::ceil((double) spec.posLoopEnd * total);
  outVoice.releaseEnd = (spec.releaseEnd > 0) ? spec.releaseEnd : (int) std::ceil((double) spec.posRelease * total);
  outVoice.end = (spec.end > 0) ? spec.end : std::max(outVoice.loopEnd, outVoice.releaseEnd);
  outVoice.pitchRatio = spec.rateRatio;
  outVoice.gainL = spec.gainL;
  outVoice.gainR = spec.gainR;
  outVoice.fadeInTotal = std::max(0, spec.fadeInSamples);
  outVoice.fadeInRemaining = outVoice.fadeInTotal;
  outVoice.fadeOutTotal = std::max(0, spec.fadeOutTotal);
  outVoice.fadeOutRemaining = std::max(0, spec.fadeOutRemaining);
  outVoice.loopCrossfadeSamples = std::max(0, spec.loopCrossfadeSamples);
  outVoice.releaseTailSamples = std::max(0, spec.releaseTailSamples);
  outVoice.zeroCrossSearchSamples = std::max(0, spec.zeroCrossSearchSamples);
  outVoice.grainSizeSamples = std::max(64, spec.grainSizeSamples);
  outVoice.grainHopSamples = std::max(16, spec.grainHopSamples);
  outVoice.holdMode = spec.useGranularHold ? Voice::HoldMode::Granular : Voice::HoldMode::Resample;
  outVoice.phase = Voice::Phase::Attack;

  if (!validateVoiceBoundaries(outVoice)) {
    if (errorMessage) *errorMessage = "Invalid Touski boundaries";
    return false;
  }

  if (spec.loopEnabled && outVoice.zeroCrossSearchSamples > 0) {
    outVoice.loopStart = snapToNearestZeroCrossing(outVoice.sample->buffer,
                                                   outVoice.loopStart,
                                                   outVoice.zeroCrossSearchSamples,
                                                   outVoice.start,
                                                   std::max(outVoice.start + 1, outVoice.releaseEnd - 2));
    outVoice.loopEnd = snapToNearestZeroCrossing(outVoice.sample->buffer,
                                                 outVoice.loopEnd,
                                                 outVoice.zeroCrossSearchSamples,
                                                 std::min(outVoice.loopStart + 2, outVoice.releaseEnd - 1),
                                                 std::max(outVoice.loopStart + 2, outVoice.releaseEnd - 1));
    validateVoiceBoundaries(outVoice);

    const int loopLen = std::max(4, outVoice.loopEnd - outVoice.loopStart);
    const int seamWindow = std::min(std::max(16, outVoice.loopCrossfadeSamples), std::max(16, loopLen - 4));
    const int seamSearchRadius = std::min(std::max(outVoice.zeroCrossSearchSamples, outVoice.loopCrossfadeSamples / 2), 2048);

    if (seamSearchRadius > 0 && seamWindow >= 16 && loopLen > seamWindow + 2) {
      const int startMax = std::max(outVoice.start + 1, outVoice.releaseEnd - seamWindow - 3);
      outVoice.loopStart = refineLoopStartForEnd(outVoice.sample->buffer,
                                                 outVoice.loopStart,
                                                 outVoice.loopEnd,
                                                 seamSearchRadius,
                                                 seamWindow,
                                                 outVoice.start,
                                                 startMax);

      const int endMin = std::min(outVoice.releaseEnd - 1, outVoice.loopStart + seamWindow + 2);
      outVoice.loopEnd = refineLoopEndForStart(outVoice.sample->buffer,
                                               outVoice.loopStart,
                                               outVoice.loopEnd,
                                               seamSearchRadius,
                                               seamWindow,
                                               endMin,
                                               outVoice.releaseEnd - 1);
      validateVoiceBoundaries(outVoice);
    }
  }

  const double playbackRate = std::max(0.0001, spec.rateRatio * (spec.sample->sampleRate / std::max(1.0, sampleRate_)));
  const int attackEnd = spec.loopEnabled ? outVoice.loopStart : outVoice.releaseEnd;

  ResampleHoldEngine::initialise(outVoice.attackState,
                                 outVoice.start,
                                 outVoice.loopStart,
                                 outVoice.loopEnd,
                                 std::max(outVoice.start + 1, attackEnd),
                                 playbackRate,
                                 false,
                                 outVoice.loopCrossfadeSamples);

  ResampleHoldEngine::initialise(outVoice.sustainState,
                                 outVoice.loopStart,
                                 outVoice.loopStart,
                                 outVoice.loopEnd,
                                 outVoice.releaseEnd,
                                 playbackRate,
                                 spec.loopEnabled && outVoice.holdMode == Voice::HoldMode::Resample,
                                 outVoice.loopCrossfadeSamples);

  ResampleHoldEngine::initialise(outVoice.releaseState,
                                 outVoice.loopStart,
                                 outVoice.loopStart,
                                 outVoice.loopEnd,
                                 outVoice.releaseEnd,
                                 playbackRate,
                                 false,
                                 outVoice.loopCrossfadeSamples);

  if (outVoice.holdMode == Voice::HoldMode::Granular && spec.loopEnabled) {
    const int loopLen = std::max(32, outVoice.loopEnd - outVoice.loopStart);
    const int guard = std::min(std::max(2, outVoice.loopCrossfadeSamples / 2), std::max(2, loopLen / 8));
    const double maxReadableDuration = grainMaxReadableDurationShared(outVoice.loopStart, outVoice.loopEnd, guard, spec.rateRatio);
    const int grainLength = std::max(16, std::min(std::max(32, outVoice.grainSizeSamples), std::max(16, (int) std::floor(maxReadableDuration))));
    const int hopSamples = std::max(8, std::min(std::max(16, outVoice.grainHopSamples), grainLength));
    const std::uint32_t seed = (std::uint32_t) (0x9e3779b9u ^ (std::uint32_t) spec.note ^ ((std::uint32_t) outVoice.loopStart << 1) ^ ((std::uint32_t) outVoice.loopEnd << 9));
    GranularHoldEngine::initialise(outVoice.granularState,
                                   outVoice.loopStart,
                                   outVoice.loopEnd,
                                   spec.rateRatio,
                                   grainLength,
                                   hopSamples,
                                   outVoice.loopCrossfadeSamples,
                                   outVoice.grainJitterSamples,
                                   outVoice.seamDiffuse,
                                   seed);
  }

  return true;
}

bool SampleTouskiRuntime::spawnVoice(const VoiceSpec& spec, juce::String* errorMessage) {
  Voice voice;
  if (!initialiseVoiceFromSpec(voice, spec, errorMessage))
    return false;

  for (auto& existing : voices_) {
    if (!existing.active) {
      existing = std::move(voice);
      return true;
    }
  }

  if ((int) voices_.size() < maxVoices_) {
    voices_.push_back(std::move(voice));
    return true;
  }

  if (errorMessage) *errorMessage = "No free Touski sample voices";
  return false;
}

void SampleTouskiRuntime::beginRelease(Voice& voice) noexcept {
  if (!voice.active) return;

  int releaseStart = voice.loopStart;

  if (voice.phase == Voice::Phase::Attack || voice.attackState.pos < (double) voice.loopStart) {
    releaseStart = ResampleHoldEngine::currentSourceIndex(voice.attackState);
  } else if (voice.holdMode == Voice::HoldMode::Granular) {
    releaseStart = GranularHoldEngine::currentSourceIndex(voice.granularState);
  } else {
    releaseStart = ResampleHoldEngine::currentSourceIndex(voice.sustainState);
  }

  voice.releasing = true;
  voice.phase = Voice::Phase::Release;

  releaseStart = juce::jlimit(voice.start, std::max(voice.start, voice.releaseEnd - 1), releaseStart);

  voice.releaseState.pos = (double) releaseStart;
  voice.releaseState.end = std::max(releaseStart + 1, voice.releaseEnd);
  voice.releaseState.loopEnabled = false;
}

bool SampleTouskiRuntime::noteOff(const juce::String& instId,
                                  int mixCh,
                                  int note,
                                  bool /*holdLoopThenRelease*/) {
  bool changed = false;
  for (auto& voice : voices_) {
    if (!voice.active) continue;
    if (voice.instId != instId || voice.mixCh != mixCh || voice.note != note) continue;

    if (!voice.releasing) {
      beginRelease(voice);
      changed = true;
    }
  }
  return changed;
}

void SampleTouskiRuntime::renderNextSample(std::vector<float>& busL, std::vector<float>& busR) noexcept {
  for (auto& voice : voices_) {
    if (!voice.active || !voice.sample) continue;

    const auto& buffer = voice.sample->buffer;
    if (buffer.getNumSamples() <= 1) {
      voice.active = false;
      continue;
    }

    float amp = 1.0f;
    if (voice.fadeInRemaining > 0 && voice.fadeInTotal > 0) {
      const int done = voice.fadeInTotal - voice.fadeInRemaining;
      amp *= (float) done / (float) std::max(1, voice.fadeInTotal);
      --voice.fadeInRemaining;
    }

    if (voice.releasing && voice.fadeOutRemaining > 0 && voice.fadeOutTotal > 0) {
      amp *= (float) voice.fadeOutRemaining / (float) std::max(1, voice.fadeOutTotal);
      --voice.fadeOutRemaining;
      if (voice.fadeOutRemaining <= 0) {
        voice.active = false;
        continue;
      }
    }

    ResampleHoldEngine::StereoFrame frame;

    if (voice.phase == Voice::Phase::Attack) {
      const auto rr = ResampleHoldEngine::renderFrame(voice.attackState, buffer);
      frame.left = rr.frame.left;
      frame.right = rr.frame.right;
      ResampleHoldEngine::advance(voice.attackState);

      if (rr.finished || voice.attackState.pos >= (double) voice.attackState.end) {
        if (voice.releasing || voice.loopEnd <= voice.loopStart) {
          voice.phase = Voice::Phase::Release;
          voice.releaseState.pos = std::max((double) voice.start, (double) ResampleHoldEngine::currentSourceIndex(voice.attackState));
          voice.releaseState.end = std::max(voice.releaseEnd, (int) std::ceil(voice.releaseState.pos) + 1);
          voice.releaseState.loopEnabled = false;
        } else {
          voice.phase = Voice::Phase::Sustain;
        }
      }
    } else if (voice.phase == Voice::Phase::Sustain) {
      if (voice.holdMode == Voice::HoldMode::Granular) {
        const auto gf = GranularHoldEngine::renderFrame(voice.granularState, buffer);
        frame.left = gf.left;
        frame.right = gf.right;
      } else {
        const auto rr = ResampleHoldEngine::renderFrame(voice.sustainState, buffer);
        frame.left = rr.frame.left;
        frame.right = rr.frame.right;
        ResampleHoldEngine::advance(voice.sustainState);
      }

      if (voice.releasing) {
        beginRelease(voice);
      }
    }

    if (voice.phase == Voice::Phase::Release) {
      const auto rr = ResampleHoldEngine::renderFrame(voice.releaseState, buffer);
      frame.left = rr.frame.left;
      frame.right = rr.frame.right;

      if (voice.releaseTailSamples > 0) {
        const double samplesToEnd = (double) voice.releaseState.end - voice.releaseState.pos;
        if (samplesToEnd <= 0.0) {
          voice.active = false;
          continue;
        }
        if (samplesToEnd <= (double) voice.releaseTailSamples)
          amp *= (float) (samplesToEnd / (double) std::max(1, voice.releaseTailSamples));
      }

      ResampleHoldEngine::advance(voice.releaseState);
      if (rr.finished || voice.releaseState.pos >= (double) voice.releaseState.end) {
        voice.active = false;
      }
    }

    if (!voice.active) continue;

    const int idx = juce::jlimit(0, (int) std::max(busL.size(), busR.size()) - 1, voice.mixCh - 1);
    if (idx < (int) busL.size()) busL[(size_t) idx] += frame.left * voice.gainL * amp;
    if (idx < (int) busR.size()) busR[(size_t) idx] += frame.right * voice.gainR * amp;
  }
}

} // namespace sls::inst
