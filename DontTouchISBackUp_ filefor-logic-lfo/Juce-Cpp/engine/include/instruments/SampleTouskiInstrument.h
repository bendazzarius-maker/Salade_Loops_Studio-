#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>

#include <cmath>
#include <functional>
#include <limits>
#include <memory>
#include <unordered_map>
#include <vector>

namespace sls::inst {

class SampleTouskiInstrument {
public:
  struct SampleData {
    juce::AudioBuffer<float> buffer;
    double sampleRate = 44100.0;
    juce::String path;
  };

  struct RuntimeParams {
    juce::String programPath;
    juce::String smartPlaybackMode = "hold_loop_then_release";
    juce::String pitchEngine = "granular";

    int rootMidi = 60;

    float posAction = 0.0f;
    float posLoopStart = 0.15f;
    float posLoopEnd = 0.90f;
    float posRelease = 1.0f;
    float sustainPct = 100.0f;

    float loopCrossfadeMs = 8.0f;
    float releaseTailMs = 4.0f;
    float fadeInMs = 2.0f;
    float zeroCrossSearchMs = 3.0f;
    float grainSizeMs = 70.0f;
    float grainOverlap = 0.78f;
    float grainJitterMs = 8.0f;
    float seamDiffuse = 0.35f;
  };

  struct Zone {
    int rootMidi = 60;
    juce::String samplePath;
    std::shared_ptr<SampleData> sample;

    float posAction = 0.0f;
    float posLoopStart = 0.15f;
    float posLoopEnd = 0.90f;
    float posRelease = 1.0f;
    float sustainPct = 100.0f;

    float loopCrossfadeMs = 8.0f;
    float releaseTailMs = 4.0f;
    float fadeInMs = 2.0f;
    float zeroCrossSearchMs = 3.0f;
    float grainSizeMs = 70.0f;
    float grainOverlap = 0.78f;
    float grainJitterMs = 8.0f;
    float seamDiffuse = 0.35f;

    bool loopEnabled = true;
  };

  struct VoiceSpec {
    bool valid = false;

    juce::String instId;
    juce::String smartPlaybackMode = "hold_loop_then_release";
    juce::String pitchEngine = "granular";

    int note = 60;
    int mixCh = 1;

    juce::String samplePath;
    int rootMidi = 60;
    std::shared_ptr<SampleData> sample;

    float posAction = 0.0f;
    float posLoopStart = 0.15f;
    float posLoopEnd = 0.90f;
    float posRelease = 1.0f;

    int start = 0;
    int loopStart = 0;
    int loopEnd = 0;
    int releaseEnd = 0;
    int end = 0;

    double rateRatio = 1.0;

    float gainL = 1.0f;
    float gainR = 1.0f;

    bool loopEnabled = false;
    bool releasing = false;
    bool useGranularHold = false;

    int fadeInSamples = 0;
    int fadeInTotal = 64;
    int fadeInRemaining = 0;
    int fadeOutTotal = 0;
    int fadeOutRemaining = 0;
    int loopCrossfadeSamples = 192;
    int releaseTailSamples = 192;
    int zeroCrossSearchSamples = 96;
    int grainSizeSamples = 2048;
    int grainHopSamples = 512;
    int grainJitterSamples = 256;
    float seamDiffuse = 0.35f;
  };

  struct ProgramState {
    RuntimeParams params;
    std::unordered_map<int, Zone> zones;
  };

  using LoadSampleFn = std::function<std::shared_ptr<SampleData>(const juce::String& absolutePath)>;

  explicit SampleTouskiInstrument(LoadSampleFn loadSampleFn = {});

  void setLoadSampleFn(LoadSampleFn fn);
  void setSampleRate(double sr);
  double getSampleRate() const noexcept;

  bool loadProgram(const juce::String& instId,
                   const juce::var& inlineProgramPayload,
                   juce::String* errorMessage = nullptr);

  bool setParams(const juce::String& instId,
                 const juce::var& paramsPayload,
                 juce::String* errorMessage = nullptr);

  bool hasProgram(const juce::String& instId) const;
  const ProgramState* getProgram(const juce::String& instId) const;

  bool buildVoiceOn(const juce::String& instId,
                    int mixCh,
                    int note,
                    float velocity,
                    VoiceSpec& outVoice,
                    juce::String* errorMessage = nullptr) const;

  bool applyNoteOff(const juce::String& instId,
                    int mixCh,
                    int note,
                    std::vector<VoiceSpec*>& activeVoices) const;

  bool shouldHoldLoopOnNoteOff(const juce::String& instId) const;

  void clearProgram(const juce::String& instId);
  void clearAll();

private:
  static float clamp01(double v);
  static int getIntProp(const juce::DynamicObject* o, const juce::Identifier& key, int fallback);
  static double getDoubleProp(const juce::DynamicObject* o, const juce::Identifier& key, double fallback);
  static juce::String getStringProp(const juce::DynamicObject* o, const juce::Identifier& key, const juce::String& fallback = {});
  static float readPctOrNorm(const juce::DynamicObject* o,
                             const juce::Identifier& normKey,
                             const juce::Identifier& pctKey,
                             float fallbackNorm);
  static void applyRuntimeParamsFromObject(RuntimeParams& p,
                                           const juce::DynamicObject* o,
                                           bool allowProgramPath);
  static void normalizeParams(RuntimeParams& p);
  static bool wantsGranularPitchEngine(const juce::String& engineName);

  Zone makeZoneFromObject(const juce::DynamicObject* o,
                          const juce::File& baseDir,
                          const RuntimeParams& parent) const;

  const Zone* findBestZone(const ProgramState& state, int midiNote) const;

  bool loadProgramFromRootObject(ProgramState& state,
                                 const juce::DynamicObject* root,
                                 const juce::File& baseDir,
                                 juce::String* errorMessage) const;

  LoadSampleFn loadSampleFn_;
  double sampleRate_ = 44100.0;
  std::unordered_map<juce::String, ProgramState> programs_;
};

} // namespace sls::inst
