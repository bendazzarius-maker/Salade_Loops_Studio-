#pragma once

#include "instruments/SampleTouskiInstrument.h"

#include <array>
#include <cstdint>
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>
#include <memory>
#include <vector>

namespace sls::inst {

class ResampleHoldEngine {
public:
  struct StereoFrame {
    float left = 0.0f;
    float right = 0.0f;
  };

  struct RenderResult {
    StereoFrame frame;
    bool finished = false;
  };

  struct State {
    double pos = 0.0;
    double rate = 1.0;
    int start = 0;
    int loopStart = 0;
    int loopEnd = 0;
    int end = 0;
    int crossfadeSamples = 0;
    bool loopEnabled = false;
  };

  static void initialise(State& state,
                         int start,
                         int loopStart,
                         int loopEnd,
                         int end,
                         double rate,
                         bool loopEnabled,
                         int crossfadeSamples) noexcept;

  static void enterRelease(State& state, int end) noexcept;
  static int currentSourceIndex(const State& state) noexcept;
  static RenderResult renderFrame(const State& state,
                                  const juce::AudioBuffer<float>& buffer) noexcept;
  static void advance(State& state) noexcept;

private:
  static float sampleAtHermite(const juce::AudioBuffer<float>& buffer, int channel, double pos) noexcept;
  static double wrapLoopPosition(double pos, int loopStart, int loopEnd) noexcept;
  static float hannFadeIn(double t) noexcept;
  static float hannFadeOut(double t) noexcept;
};

class GranularHoldEngine {
public:
  struct StereoFrame {
    float left = 0.0f;
    float right = 0.0f;
  };

  struct Grain {
    bool active = false;
    double sourceStart = 0.0;
    double sourceEnd = 0.0;
    double step = 1.0;
    int age = 0;
    int duration = 0;
  };

  struct State {
    bool prepared = false;
    double pitchRatio = 1.0;
    double nextSourceStart = 0.0;
    double analysisHop = 128.0;
    double scanDirection = 1.0;
    double lastSpawnStart = 0.0;
    int loopStart = 0;
    int loopEnd = 0;
    int grainLength = 512;
    int hopSamples = 128;
    int samplesUntilSpawn = 0;
    int crossfadeSamples = 0;
    int jitterSamples = 0;
    float seamDiffuse = 0.35f;
    std::uint32_t rngState = 0x9e3779b9u;
    std::array<Grain, 16> grains;
  };

  static void initialise(State& state,
                         int loopStart,
                         int loopEnd,
                         double pitchRatio,
                         int grainLengthSamples,
                         int hopSamples,
                         int crossfadeSamples,
                         int jitterSamples,
                         float seamDiffuse,
                         std::uint32_t seed) noexcept;

  static int currentSourceIndex(const State& state) noexcept;
  static StereoFrame renderFrame(State& state,
                                 const juce::AudioBuffer<float>& buffer) noexcept;

private:
  static float sampleAtHermite(const juce::AudioBuffer<float>& buffer, int channel, double pos) noexcept;
  static double wrapLoopPosition(double pos, int loopStart, int loopEnd) noexcept;
  static float hannWindow(int age, int duration) noexcept;
  static float nextRandomSigned(State& state) noexcept;
  static int chooseGrainStart(const State& state,
                              const juce::AudioBuffer<float>& buffer,
                              int predictedStart) noexcept;
  static void spawnGrain(State& state, const juce::AudioBuffer<float>& buffer) noexcept;
};

class SampleTouskiRuntime {
public:
  using SampleData = SampleTouskiInstrument::SampleData;
  using VoiceSpec = SampleTouskiInstrument::VoiceSpec;

  struct Voice {
    enum class HoldMode { Resample, Granular };
    enum class Phase { Attack, Sustain, Release };

    bool active = false;
    bool releasing = false;

    juce::String instId;
    int note = 60;
    int mixCh = 1;

    std::shared_ptr<SampleData> sample;

    int start = 0;
    int loopStart = 0;
    int loopEnd = 0;
    int releaseEnd = 0;
    int end = 0;

    double pitchRatio = 1.0;
    float gainL = 1.0f;
    float gainR = 1.0f;

    int fadeOutTotal = 0;
    int fadeOutRemaining = 0;
    int fadeInTotal = 64;
    int fadeInRemaining = 0;
    int loopCrossfadeSamples = 192;
    int releaseTailSamples = 192;
    int zeroCrossSearchSamples = 96;
    int grainSizeSamples = 2048;
    int grainHopSamples = 512;
    int grainJitterSamples = 256;
    float seamDiffuse = 0.35f;

    HoldMode holdMode = HoldMode::Granular;
    Phase phase = Phase::Attack;

    ResampleHoldEngine::State attackState;
    ResampleHoldEngine::State sustainState;
    ResampleHoldEngine::State releaseState;
    GranularHoldEngine::State granularState;
  };

  explicit SampleTouskiRuntime(int maxVoices = 128);

  void setSampleRate(double sr) noexcept;
  double getSampleRate() const noexcept;

  void setMaxVoices(int maxVoices);
  int getMaxVoices() const noexcept;

  bool spawnVoice(const VoiceSpec& spec, juce::String* errorMessage = nullptr);
  bool noteOff(const juce::String& instId, int mixCh, int note, bool holdLoopThenRelease);

  void renderNextSample(std::vector<float>& busL, std::vector<float>& busR) noexcept;

  void clear();
  void stopAll() noexcept;

  const std::vector<Voice>& getVoices() const noexcept;
  int getNumActiveVoices() const noexcept;

private:
  static int snapToNearestZeroCrossing(const juce::AudioBuffer<float>& buffer,
                                       int target,
                                       int searchRadius,
                                       int minBound,
                                       int maxBound) noexcept;
  static bool validateVoiceBoundaries(Voice& voice) noexcept;

  bool initialiseVoiceFromSpec(Voice& outVoice,
                               const VoiceSpec& spec,
                               juce::String* errorMessage) const;
  static void beginRelease(Voice& voice) noexcept;

  std::vector<Voice> voices_;
  double sampleRate_ = 44100.0;
  int maxVoices_ = 128;
};

} // namespace sls::inst
