#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <iostream>
#include <memory>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>

#if defined(_WIN32) || defined(_WIN64)
  #include <windows.h>
  #define SLS_GET_PID() ((int)::GetCurrentProcessId())
#else
  #include <unistd.h>
  #define SLS_GET_PID() ((int)::getpid())
#endif

namespace {

constexpr double kTwoPi = 6.283185307179586;
constexpr int    kMaxSynthVoices  = 64;
constexpr int    kMaxSampleVoices = 128;
constexpr int    kStepsPerBeat    = 16;

juce::int64 nowMs() { return juce::Time::currentTimeMillis(); }

// ------------------------------ Data structures ------------------------------

struct Voice {
  bool active = false;
  bool releasing = false;

  juce::String instId = "global";
  int mixCh = 1;
  int note = 60;

  float velocity = 0.8f;
  float gain = 1.0f;

  float attack = 0.003f, decay = 0.12f, sustain = 0.7f, release = 0.2f;
  int waveform = 0;

  int ageSamples = 0;
  float env = 0.0f;

  double phase = 0.0;
  double phaseInc = 0.0;
};

struct SampleData {
  double sampleRate = 48000.0;
  juce::AudioBuffer<float> buffer;
};

struct SampleVoice {
  bool active = false;
  bool releasing = false;

  juce::String instId = "sampler";
  int note = 60;

  std::shared_ptr<const SampleData> sample;
  int start = 0;
  int end = 0;

  double pos = 0.0;
  double rate = 1.0;

  float gainL = 1.0f;
  float gainR = 1.0f;
  int mixCh = 1;

  int fadeOutTotal = 256;
  int fadeOutRemaining = 0;
};

struct InstrumentState {
  juce::String type = "piano";
  float gain = 1.0f;

  float attack = 0.003f, decay = 0.12f, sustain = 0.7f, release = 0.2f;
  float fm = 0.0f;
  int waveform = 0;

  juce::var juceSpec;
};

struct MixerChannelState {
  float gain = 0.85f;
  float pan  = 0.0f;
  float eqLow  = 0.0f;
  float eqMid  = 0.0f;
  float eqHigh = 0.0f;
  bool mute = false;
  bool solo = false;
};

struct FxUnit {
  juce::String id;
  juce::String type;
  bool enabled = true;
  bool bypass = false;
  juce::NamedValueSet params;
  juce::Reverb reverb;

  float getParam(const juce::String& name, float def) const {
    const auto v = params.getWithDefault(name, def);
    if (v.isInt() || v.isDouble()) return (float)(double)v;
    return def;
  }
};

struct ChannelDSP {
  juce::dsp::IIR::Filter<float> lowL, lowR, midL, midR, highL, highR;
  std::vector<std::unique_ptr<FxUnit>> fx;

  void processEq(float& l, float& r) {
    l = highL.processSample(midL.processSample(lowL.processSample(l)));
    r = highR.processSample(midR.processSample(lowR.processSample(r)));
  }
};

struct ScheduledEvent {
  double atPpq = 0.0;
  juce::String type;
  juce::String instId;
  int mixCh = 1;
  int note = 60;
  float vel = 0.85f;
  double durPpq = 0.25;
  juce::var payload;
};

// Block-dispatch sample-accurate
struct BlockEvent {
  int offset = 0;           // 0..n-1
  ScheduledEvent ev;
};

// ------------------------------ Helpers ------------------------------

static double getDoubleProp(const juce::DynamicObject* o, const char* key, double def) {
  if (!o) return def;
  const auto v = o->getProperty(key);
  return (v.isInt() || v.isDouble()) ? (double)v : def;
}

static int getIntProp(const juce::DynamicObject* o, const char* key, int def) {
  return (int)std::llround(getDoubleProp(o, key, def));
}

static juce::String getStringProp(const juce::DynamicObject* o, const char* key, const juce::String& def = {}) {
  if (!o) return def;
  const auto v = o->getProperty(key);
  return v.isString() ? v.toString() : def;
}

static bool getBoolProp(const juce::DynamicObject* o, const char* key, bool def) {
  if (!o) return def;
  const auto v = o->getProperty(key);
  if (v.isBool()) return (bool)v;
  if (v.isInt() || v.isDouble()) return ((double)v) >= 0.5;
  return def;
}

class Engine : public juce::AudioIODeviceCallback {
public:
  Engine() {
    formatManager.registerBasicFormats();

    mixerStates.resize((size_t)channelCount);
    channelDsp.resize((size_t)channelCount);
    resizeMeters(channelCount);

    setupAudio();
    refreshDspSpecs();

    // Start event pump AFTER audio is setup
    stateThread = std::thread([this] { pumpEvents(); });

    emitEvt("engine.state", engineState());
    emitEvt("transport.state", transportState());
  }

  ~Engine() override {
    running.store(false);
    if (stateThread.joinable()) stateThread.join();
    shutdownAudio();
  }

  bool isRunning() const { return running.load(); }

  // ------------------------------ IPC handler ------------------------------

  void handle(const juce::var& msg) {
    auto* obj = msg.getDynamicObject();
    if (!obj || obj->getProperty("type").toString() != "req") return;

    const auto op = obj->getProperty("op").toString();
    const auto id = obj->getProperty("id").toString();
    const auto data = obj->getProperty("data");
    const auto* d = data.getDynamicObject();

    // Engine
    if (op == "engine.hello")       return resOk(op, id, helloData());
    if (op == "engine.ping")        return resOk(op, id, data);
    if (op == "engine.state.get")   return resOk(op, id, engineState());
    if (op == "engine.config.get")  return resOk(op, id, engineConfig());
    if (op == "engine.config.set")  return handleEngineConfigSet(op, id, d);
    if (op == "engine.shutdown")    { running.store(false); return resOk(op, id, juce::var()); }

    // Project + Scheduler
    if (op == "project.sync")        return handleProjectSync(op, id, d, data);
    if (op == "schedule.clear")      return handleScheduleClear(op, id);
    if (op == "schedule.setWindow")  return handleScheduleSetWindow(op, id, d);
    if (op == "schedule.push")       return handleSchedulePush(op, id, d);

    // Mixer init
    if (op == "mixer.init")          return handleMixerInit(op, id, d);

    // Transport
    if (op == "transport.play") {
      {
        std::scoped_lock lk(stateMutex);
        const double prerollSec = std::max(0.0, playPrerollMs.load() / 1000.0);
        playStartSamplePos = samplePos + (juce::int64)std::llround(prerollSec * std::max(1.0, sampleRate));
        playArmed.store(true);
      }
      playing.store(false);
      resOk(op, id, juce::var());
      emitEvt("transport.state", transportState());
      return;
    }

    if (op == "transport.stop") {
      playing.store(false);
      playArmed.store(false);
      panic();
      resOk(op, id, juce::var());
      emitEvt("transport.state", transportState());
      return;
    }

    if (op == "transport.seek") {
      std::scoped_lock lk(stateMutex);
      const bool hasSamplePos = d && d->hasProperty("samplePos");
      samplePos = hasSamplePos
        ? (juce::int64)getDoubleProp(d, "samplePos", 0.0)
        : ppqToSamples(getDoubleProp(d, "ppq", 0.0));
      playArmed.store(false);
      playing.store(false);

      // Reset scheduler cursor to the first event >= current ppq
      schedulerCursor = 0;
      const double curPpq = samplesToPpq(samplePos);
      while (schedulerCursor < scheduler.size() && scheduler[schedulerCursor].atPpq < curPpq) ++schedulerCursor;

      resOk(op, id, juce::var());
      emitEvt("transport.state", transportState());
      return;
    }

    if (op == "transport.setTempo") {
      bpm.store(std::max(20.0, getDoubleProp(d, "bpm", bpm.load())));
      resOk(op, id, juce::var());
      emitEvt("transport.state", transportState());
      return;
    }

    if (op == "transport.state.get") return resOk(op, id, transportState());

    // Instruments (synth)
    if (op == "inst.create")     return handleInstCreate(op, id, d);
    if (op == "inst.param.set")  return handleInstParamSet(op, id, d);

    // Note events (synth by default)
    if (op == "note.on" || op == "midi.noteOn") {
      startVoice(getStringProp(d, "instId", "global"),
                 getIntProp(d, "mixCh", 1),
                 getIntProp(d, "note", 60),
                 (float)getDoubleProp(d, "vel", getDoubleProp(d, "velocity", 0.85)));
      return resOk(op, id, juce::var());
    }

    if (op == "note.off" || op == "midi.noteOff") {
      stopVoice(getStringProp(d, "instId", "global"),
                getIntProp(d, "mixCh", 1),
                getIntProp(d, "note", 60));
      return resOk(op, id, juce::var());
    }

    if (op == "note.allOff" || op == "midi.panic") {
      panic();
      return resOk(op, id, juce::var());
    }

    // Touski (sample instrument)
    if (op == "touski.program.load") return handleTouskiProgramLoad(op, id, d);
    if (op == "touski.param.set")    return resOk(op, id, juce::var()); // stub ok
    if (op == "touski.note.on")      return handleTouskiNoteOn(op, id, d);
    if (op == "touski.note.off")     return handleTouskiNoteOff(op, id, d);

    // Sampler / Sample Pattern
    if (op == "sampler.load")    return handleSamplerLoad(op, id, d);
    if (op == "sampler.unload")  { if (d) sampleCache.erase(getStringProp(d, "sampleId", "")); return resOk(op, id, juce::var()); }
    if (op == "sampler.trigger") return handleSamplerTrigger(op, id, d);

    // Mixer + FX
    if (op == "mixer.param.set")   return handleMixerParamSet(op, id, d);
    if (op == "mixer.master.set")  return handleMixerCompatMaster(op, id, d);
    if (op == "mixer.channel.set") return handleMixerCompatChannel(op, id, d);

    if (op == "fx.chain.set" || op == "fx.param.set" || op == "fx.bypass.set")
      return handleFxSetOp(op, id, d);

    // Meter
    if (op == "meter.subscribe")   return handleMeterSubscribe(op, id, d);
    if (op == "meter.unsubscribe") return handleMeterUnsubscribe(op, id);

    return resErr(op, id, "E_UNKNOWN_OP", "Unknown opcode");
  }

  // ------------------------------ Audio callbacks ------------------------------

  void audioDeviceAboutToStart(juce::AudioIODevice* d) override {
    if (!d) return;
    sampleRate = d->getCurrentSampleRate();
    bufferSize = d->getCurrentBufferSizeSamples();
    ready = true;

    refreshDspSpecs();

    // Pre-size to avoid realloc in callback
    busL.assign((size_t)juce::jmax(1, channelCount), 0.0f);
    busR.assign((size_t)juce::jmax(1, channelCount), 0.0f);

    // Safety: reset delay write index
    delayIndex = 0;
  }

  void audioDeviceStopped() override {}

  void audioDeviceIOCallbackWithContext(const float* const*, int,
                                       float* const* out, int outChs,
                                       int n,
                                       const juce::AudioIODeviceCallbackContext&) override
  {
    std::scoped_lock lk(audioMutex);

    for (int ch = 0; ch < outChs; ++ch)
      if (out[ch]) juce::FloatVectorOperations::clear(out[ch], n);

    if (playArmed.load() && samplePos >= playStartSamplePos) {
      playArmed.store(false);
      playing.store(true);
    }

    // Prepare block events (sample accurate offsets)
    if (playing.load())
      prepareBlockEvents(n);
    else
      blockEvents.clear();

    // Determine solo state (per block)
    bool anySolo = false;
    for (const auto& mc : mixerStates) { if (mc.solo) { anySolo = true; break; } }

    // Iterate per-sample
    size_t nextEv = 0;

    for (int i = 0; i < n; ++i) {
      // Fire scheduled events at this sample offset
      while (nextEv < blockEvents.size() && blockEvents[nextEv].offset == i) {
        dispatchOneEvent(blockEvents[nextEv].ev);
        ++nextEv;
      }

      std::fill(busL.begin(), busL.end(), 0.0f);
      std::fill(busR.begin(), busR.end(), 0.0f);

      // Sample voices
      for (auto& sv : sampleVoices) {
        if (!sv.active || !sv.sample) continue;

        const auto& b = sv.sample->buffer;
        const int ip = (int)sv.pos;

        if (ip >= sv.end || ip >= b.getNumSamples() - 1) {
          sv.active = false;
          continue;
        }

        float fade = 1.0f;
        if (sv.releasing) {
          if (sv.fadeOutRemaining <= 0) {
            sv.active = false;
            continue;
          }
          fade = (float)sv.fadeOutRemaining / (float)std::max(1, sv.fadeOutTotal);
          --sv.fadeOutRemaining;
        }

        const float frac = (float)(sv.pos - ip);
        float inL = b.getSample(0, ip) + (b.getSample(0, ip + 1) - b.getSample(0, ip)) * frac;
        float inR = (b.getNumChannels() > 1)
          ? (b.getSample(1, ip) + (b.getSample(1, ip + 1) - b.getSample(1, ip)) * frac)
          : inL;

        int idx = juce::jlimit(0, (int)mixerStates.size() - 1, sv.mixCh - 1);
        const auto& mc = mixerStates[(size_t)idx];

        if (mc.mute || (anySolo && !mc.solo)) { sv.pos += sv.rate; continue; }

        busL[(size_t)idx] += inL * sv.gainL * fade;
        busR[(size_t)idx] += inR * sv.gainR * fade;

        sv.pos += sv.rate;
      }

      // Synth voices
      for (auto& v : voices) {
        if (!v.active) continue;

        const int atkS = std::max(1, (int)std::llround(v.attack * sampleRate));
        const int decS = std::max(1, (int)std::llround(v.decay * sampleRate));
        const int relS = std::max(1, (int)std::llround(v.release * sampleRate));

        if (!v.releasing) {
          if (v.ageSamples < atkS) v.env = (float)v.ageSamples / (float)atkS;
          else if (v.ageSamples < atkS + decS) {
            const float t = (float)(v.ageSamples - atkS) / (float)decS;
            v.env = 1.0f - (1.0f - v.sustain) * t;
          } else v.env = v.sustain;
        } else {
          const float mul = std::exp(std::log(0.0001f) / (float)relS);
          v.env *= mul;
          if (v.env < 0.0001f) { v.active = false; continue; }
        }

        float sig = 0.0f;
        switch (v.waveform) {
          default:
          case 0: sig = (float)std::sin(v.phase); break;              // sine
          case 1: sig = (float)((2.0 * (v.phase / kTwoPi)) - 1.0); break; // saw-ish
          case 2: sig = (v.phase < kTwoPi * 0.5) ? 1.0f : -1.0f; break;   // square
        }

        v.phase += v.phaseInc;
        if (v.phase > kTwoPi) v.phase -= kTwoPi;

        int idx = juce::jlimit(0, (int)mixerStates.size() - 1, v.mixCh - 1);
        const auto& mc = mixerStates[(size_t)idx];

        if (mc.mute || (anySolo && !mc.solo)) { ++v.ageSamples; continue; }

        const float amp = sig * v.velocity * v.gain * v.env * 0.2f;
        busL[(size_t)idx] += amp;
        busR[(size_t)idx] += amp;

        ++v.ageSamples;
      }

      // Mix channels -> master
      float L = 0.0f, R = 0.0f;

      for (int ch = 0; ch < channelCount; ++ch) {
        float cl = busL[(size_t)ch];
        float cr = busR[(size_t)ch];

        // EQ + FX
        channelDsp[(size_t)ch].processEq(cl, cr);
        processFxChain(channelDsp[(size_t)ch].fx, cl, cr);

        // channel gain/pan
        const auto& m = mixerStates[(size_t)ch];
        cl *= m.gain;
        cr *= m.gain;

        const float pan = juce::jlimit(-1.0f, 1.0f, m.pan);
        const float outL = cl * (1.0f - pan);
        const float outR = cr * (1.0f + pan);

        // Meters (per-sample accumulation into block rms)
        meterChPeakL[(size_t)ch] = std::max(meterChPeakL[(size_t)ch], std::abs(outL));
        meterChPeakR[(size_t)ch] = std::max(meterChPeakR[(size_t)ch], std::abs(outR));
        meterChRmsAccL[(size_t)ch] += outL * outL;
        meterChRmsAccR[(size_t)ch] += outR * outR;

        L += outL;
        R += outR;
      }

      // Master FX
      processFxChain(masterFx, L, R);

      // Master gain + crossfader
      L *= masterGain;
      R *= masterGain;

      // Crossfader (simple stereo balance style; keeps audible behavior)
      // crossfader -1 => favor Left, +1 => favor Right
      const float xf = juce::jlimit(-1.0f, 1.0f, crossfader);
      const float xfL = (xf < 0.0f) ? 1.0f : (1.0f - xf);
      const float xfR = (xf > 0.0f) ? 1.0f : (1.0f + xf);
      L *= xfL;
      R *= xfR;

      // Output
      if (outChs > 0 && out[0]) out[0][i] = L;
      if (outChs > 1 && out[1]) out[1][i] = R;

      // Master meters
      meterPeakL = std::max(meterPeakL, std::abs(L));
      meterPeakR = std::max(meterPeakR, std::abs(R));
      meterRmsAccL += L * L;
      meterRmsAccR += R * R;
    }

    // Advance transport
    samplePos += n;

    // Finalize RMS per block
    meterRmsL = (float)std::sqrt(meterRmsAccL / (double)std::max(1, n));
    meterRmsR = (float)std::sqrt(meterRmsAccR / (double)std::max(1, n));
    meterRmsAccL = 0.0;
    meterRmsAccR = 0.0;

    for (size_t i = 0; i < meterChRmsAccL.size(); ++i) {
      meterChRmsL[i] = (float)std::sqrt(meterChRmsAccL[i] / (double)std::max(1, n));
      meterChRmsR[i] = (float)std::sqrt(meterChRmsAccR[i] / (double)std::max(1, n));
      meterChRmsAccL[i] = 0.0;
      meterChRmsAccR[i] = 0.0;
    }
  }

private:
  // ------------------------------ JUCE devices ------------------------------

  juce::AudioDeviceManager deviceManager;
  juce::AudioFormatManager formatManager;

  // ------------------------------ Synchronization ------------------------------

  std::mutex ioMutex;
  std::mutex audioMutex;
  std::mutex stateMutex;

  std::atomic<bool> running { true };
  std::atomic<bool> playing { false };
  std::atomic<bool> playArmed { false };
  std::atomic<double> bpm { 120.0 };
  std::atomic<double> playPrerollMs { 120.0 };
  std::thread stateThread;

  // ------------------------------ Engine state ------------------------------

  bool ready = false;
  double sampleRate = 48000.0;
  int bufferSize = 512;
  int channelCount = 16;
  int numOut = 2;
  int numIn = 0;

  float masterGain = 0.85f;
  float crossfader = 0.0f;

  juce::int64 samplePos = 0;
  juce::int64 playStartSamplePos = 0;

  // ------------------------------ Voices & assets ------------------------------

  std::vector<Voice> voices;
  std::vector<SampleVoice> sampleVoices;

  std::unordered_map<juce::String, std::shared_ptr<SampleData>> sampleCache;
  std::unordered_map<juce::String, InstrumentState> instruments;

  // Touski mapping: instId -> (note -> sample)
  std::unordered_map<juce::String, std::unordered_map<int, std::shared_ptr<SampleData>>> touskiNoteSamples;

  // ------------------------------ Mixer & FX ------------------------------

  std::vector<MixerChannelState> mixerStates;
  std::vector<ChannelDSP> channelDsp;
  std::vector<std::unique_ptr<FxUnit>> masterFx;

  // Delay buffers (shared)
  mutable int delayIndex = 0;
  std::array<float, 192000> delayBufferL {};
  std::array<float, 192000> delayBufferR {};

  // bus buffers (avoid alloc in callback)
  std::vector<float> busL;
  std::vector<float> busR;

  // ------------------------------ Scheduler ------------------------------

  std::vector<ScheduledEvent> scheduler;
  size_t schedulerCursor = 0;
  double scheduleWindowFromPpq = 0.0;
  double scheduleWindowToPpq = 0.0;
  juce::var lastProjectSync;
  bool schedulerDebug = false;

  std::vector<BlockEvent> blockEvents;

  // ------------------------------ Metering ------------------------------

  bool meterSubscribed = false;
  int meterFps = 30;
  std::unordered_set<int> meterChannels;

  float meterPeakL = 0.0f, meterPeakR = 0.0f;
  float meterRmsL  = 0.0f, meterRmsR  = 0.0f;
  double meterRmsAccL = 0.0, meterRmsAccR = 0.0;

  std::vector<float>  meterChPeakL, meterChPeakR, meterChRmsL, meterChRmsR;
  std::vector<double> meterChRmsAccL, meterChRmsAccR;

  // ------------------------------ Setup ------------------------------

  void setupAudio() {
    deviceManager.initialise(numIn, numOut, nullptr, true, {}, nullptr);
    deviceManager.addAudioCallback(this);
  }

  void shutdownAudio() {
    deviceManager.removeAudioCallback(this);
    deviceManager.closeAudioDevice();
  }

  void resizeMeters(int channels) {
    meterChPeakL.assign((size_t)channels, 0.0f);
    meterChPeakR.assign((size_t)channels, 0.0f);
    meterChRmsL.assign((size_t)channels, 0.0f);
    meterChRmsR.assign((size_t)channels, 0.0f);
    meterChRmsAccL.assign((size_t)channels, 0.0);
    meterChRmsAccR.assign((size_t)channels, 0.0);
  }

  static InstrumentState defaultsForType(const juce::String& type) {
    InstrumentState st;
    st.type = type;
    // You can add defaults per type later (piano, rhodes, subbass, drums, etc.)
    return st;
  }

  double samplesToPpq(juce::int64 samples) const {
    const double bps = bpm.load() / 60.0;
    return ((double)samples / std::max(1.0, sampleRate)) * bps;
  }

  juce::int64 ppqToSamples(double ppq) const {
    const double bps = bpm.load() / 60.0;
    return (juce::int64)std::llround((ppq / std::max(1e-9, bps)) * std::max(1.0, sampleRate));
  }

  // ------------------------------ EQ / DSP ------------------------------

  void refreshEqForChannel(int ch) {
    if (ch < 0 || ch >= (int)channelDsp.size() || ch >= (int)mixerStates.size()) return;

    auto& dsp = channelDsp[(size_t)ch];
    const auto& m = mixerStates[(size_t)ch];

    const auto sr = std::max(22050.0, sampleRate);

    dsp.lowL.coefficients  = juce::dsp::IIR::Coefficients<float>::makeLowShelf (sr, 120.0f,  0.707f, juce::Decibels::decibelsToGain(m.eqLow));
    dsp.lowR.coefficients  = juce::dsp::IIR::Coefficients<float>::makeLowShelf (sr, 120.0f,  0.707f, juce::Decibels::decibelsToGain(m.eqLow));
    dsp.midL.coefficients  = juce::dsp::IIR::Coefficients<float>::makePeakFilter(sr, 1200.0f, 0.9f,   juce::Decibels::decibelsToGain(m.eqMid));
    dsp.midR.coefficients  = juce::dsp::IIR::Coefficients<float>::makePeakFilter(sr, 1200.0f, 0.9f,   juce::Decibels::decibelsToGain(m.eqMid));
    dsp.highL.coefficients = juce::dsp::IIR::Coefficients<float>::makeHighShelf(sr, 8000.0f,  0.707f, juce::Decibels::decibelsToGain(m.eqHigh));
    dsp.highR.coefficients = juce::dsp::IIR::Coefficients<float>::makeHighShelf(sr, 8000.0f,  0.707f, juce::Decibels::decibelsToGain(m.eqHigh));

    dsp.lowL.reset(); dsp.lowR.reset();
    dsp.midL.reset(); dsp.midR.reset();
    dsp.highL.reset(); dsp.highR.reset();
  }

  void refreshDspSpecs() {
    juce::dsp::ProcessSpec spec { sampleRate, (juce::uint32)juce::jmax(1, bufferSize), 1 };

    for (int ch = 0; ch < channelCount; ++ch) {
      auto& d = channelDsp[(size_t)ch];
      d.lowL.prepare(spec);  d.lowR.prepare(spec);
      d.midL.prepare(spec);  d.midR.prepare(spec);
      d.highL.prepare(spec); d.highR.prepare(spec);
      refreshEqForChannel(ch);
    }
  }

  // ------------------------------ FX ------------------------------

  std::vector<std::unique_ptr<FxUnit>>& resolveFxTarget(const juce::DynamicObject* d) {
    if (d && d->hasProperty("target")) {
      if (auto* t = d->getProperty("target").getDynamicObject()) {
        if (getStringProp(t, "scope", "master") == "ch") {
          const int ch = juce::jlimit(0, channelCount - 1, getIntProp(t, "ch", 0));
          return channelDsp[(size_t)ch].fx;
        }
      }
    }
    return masterFx;
  }

  FxUnit* findFx(std::vector<std::unique_ptr<FxUnit>>& list, const juce::String& fxId) {
    for (auto& fx : list) if (fx && fx->id == fxId) return fx.get();
    return nullptr;
  }

  void handleFxSetOp(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    auto& list = resolveFxTarget(d);

    if (op == "fx.chain.set") {
      list.clear();
      if (d && d->hasProperty("chain") && d->getProperty("chain").isArray()) {
        for (const auto& item : *d->getProperty("chain").getArray()) {
          auto* o = item.getDynamicObject();
          if (!o) continue;

          auto u = std::make_unique<FxUnit>();
          u->id = getStringProp(o, "id", "fx");
          u->type = getStringProp(o, "type", "reverb");
          u->enabled = !o->hasProperty("enabled") || (bool)o->getProperty("enabled");
          u->bypass = o->hasProperty("bypass") ? (bool)o->getProperty("bypass") : false;

          if (o->hasProperty("params")) {
            if (auto* p = o->getProperty("params").getDynamicObject())
              u->params = p->getProperties();
          }
          list.push_back(std::move(u));
        }
      }
      return resOk(op, id, juce::var());
    }

    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data object");

    if (op == "fx.param.set") {
      const auto fxId = getStringProp(d, "id", "fx");
      auto* fx = findFx(list, fxId);

      if (!fx) {
        auto u = std::make_unique<FxUnit>();
        u->id = fxId;
        u->type = getStringProp(d, "type", "reverb");
        u->enabled = true;
        fx = u.get();
        list.push_back(std::move(u));
      }

      if (d->hasProperty("params")) {
        if (auto* p = d->getProperty("params").getDynamicObject())
          fx->params = p->getProperties();
      }
      return resOk(op, id, juce::var());
    }

    if (op == "fx.bypass.set") {
      const auto fxId = getStringProp(d, "id", "fx");
      if (auto* fx = findFx(list, fxId))
        fx->bypass = d->hasProperty("bypass") ? (bool)d->getProperty("bypass") : false;
      return resOk(op, id, juce::var());
    }

    return resErr(op, id, "E_UNKNOWN_OP", "Unknown opcode");
  }

  void processFxChain(std::vector<std::unique_ptr<FxUnit>>& fx, float& l, float& r) {
    for (auto& uPtr : fx) {
      if (!uPtr) continue;
      auto& u = *uPtr;
      if (!u.enabled || u.bypass) continue;

      const auto type = u.type.toLowerCase();

      if (type.contains("reverb")) {
        juce::Reverb::Parameters p;
        p.roomSize = juce::jlimit(0.0f, 1.0f, u.getParam("roomSize", 0.35f));
        p.damping  = juce::jlimit(0.0f, 1.0f, u.getParam("damping",  0.45f));
        p.wetLevel = juce::jlimit(0.0f, 1.0f, u.getParam("mix",      0.25f));
        p.dryLevel = 1.0f;
        p.width    = juce::jlimit(0.0f, 1.0f, u.getParam("width",    1.0f));
        u.reverb.setParameters(p);
        u.reverb.processStereo(&l, &r, 1);
        continue;
      }

      if (type.contains("delay")) {
        const float t   = juce::jlimit(0.01f, 1.5f, u.getParam("time", 0.24f));
        const float fb  = juce::jlimit(0.0f,  0.95f, u.getParam("feedback", 0.3f));
        const float wet = juce::jlimit(0.0f,  1.0f, u.getParam("mix", 0.25f));

        const int delaySamp = (int)std::llround(t * std::max(1.0, sampleRate));
        const int idx = delayIndex++ % (int)delayBufferL.size();
        const int ridx = (idx - delaySamp + (int)delayBufferL.size()) % (int)delayBufferL.size();

        const float dl = delayBufferL[(size_t)ridx];
        const float dr = delayBufferR[(size_t)ridx];

        delayBufferL[(size_t)idx] = l + dl * fb;
        delayBufferR[(size_t)idx] = r + dr * fb;

        l = l * (1.0f - wet) + dl * wet;
        r = r * (1.0f - wet) + dr * wet;
        continue;
      }
    }
  }

  // ------------------------------ Synth voice management ------------------------------

  void startVoice(const juce::String& instId, int mixCh, int note, float velocity) {
    auto it = instruments.find(instId);
    if (it == instruments.end())
      it = instruments.emplace(instId, defaultsForType("piano")).first;

    const auto& st = it->second;

    Voice v;
    v.active = true;
    v.releasing = false;

    v.instId = instId;
    v.mixCh  = juce::jmax(1, mixCh);
    v.note   = note;

    v.velocity = juce::jlimit(0.0f, 1.0f, velocity);
    v.gain = st.gain;

    v.attack  = st.attack;
    v.decay   = st.decay;
    v.sustain = st.sustain;
    v.release = st.release;
    v.waveform = st.waveform;

    const double hz = 440.0 * std::pow(2.0, (note - 69) / 12.0);
    v.phaseInc = kTwoPi * hz / std::max(1.0, sampleRate);

    for (auto& s : voices) {
      if (!s.active) { s = v; return; }
    }
    if ((int)voices.size() < kMaxSynthVoices) voices.push_back(v);
  }

  void stopVoice(const juce::String& instId, int mixCh, int note) {
    for (auto& v : voices) {
      if (!v.active) continue;
      if (v.instId == instId && v.mixCh == mixCh && v.note == note)
        v.releasing = true;
    }
  }

  // ------------------------------ Sample voice management ------------------------------

  void stopSampleVoicesMatching(const juce::String& instId, int mixCh, int note) {
    for (auto& sv : sampleVoices) {
      if (!sv.active) continue;
      if (sv.instId == instId && sv.mixCh == mixCh && sv.note == note) {
        sv.releasing = true;
        sv.fadeOutTotal = 256;
        sv.fadeOutRemaining = sv.fadeOutTotal;
      }
    }
  }

  void panic() {
    for (auto& v : voices) v.active = false;
    for (auto& sv : sampleVoices) sv.active = false;
  }

  // ------------------------------ Sample IO ------------------------------

  std::shared_ptr<SampleData> loadSampleFromPath(const juce::String& p) {
    juce::File f(p);
    if (p.isEmpty() || !f.existsAsFile()) return {};

    auto r = std::unique_ptr<juce::AudioFormatReader>(formatManager.createReaderFor(f));
    if (!r) return {};

    auto sd = std::make_shared<SampleData>();
    sd->sampleRate = r->sampleRate;
    sd->buffer.setSize((int)r->numChannels, (int)r->lengthInSamples);
    r->read(&sd->buffer, 0, (int)r->lengthInSamples, 0, true, true);
    return sd;
  }

  // ------------------------------ Engine config / init ------------------------------

  void handleEngineConfigSet(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    sampleRate = std::max(22050.0, getDoubleProp(d, "sampleRate", sampleRate));
    bufferSize = std::max(64, getIntProp(d, "bufferSize", bufferSize));
    numOut     = std::max(1, getIntProp(d, "numOut", numOut));
    numIn      = std::max(0, getIntProp(d, "numIn", numIn));
    playPrerollMs.store(std::max(0.0, getDoubleProp(d, "playPrerollMs", playPrerollMs.load())));
    schedulerDebug = getBoolProp(d, "schedulerDebug", schedulerDebug);

    shutdownAudio();
    setupAudio();
    refreshDspSpecs();

    resOk(op, id, engineConfig());
  }

  void handleMixerInit(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    channelCount = juce::jlimit(1, 64, getIntProp(d, "channels", channelCount));

    mixerStates.resize((size_t)channelCount);
    channelDsp.resize((size_t)channelCount);
    resizeMeters(channelCount);

    refreshDspSpecs();

    // Keep buses in sync
    busL.assign((size_t)juce::jmax(1, channelCount), 0.0f);
    busR.assign((size_t)juce::jmax(1, channelCount), 0.0f);

    resOk(op, id, juce::var());
  }

  void handleProjectSync(const juce::String& op, const juce::String& id, const juce::DynamicObject*, const juce::var& fullData) {
    std::scoped_lock lk(stateMutex);
    lastProjectSync = fullData;
    resOk(op, id, juce::var());
  }

  // ------------------------------ Scheduler ------------------------------

  void handleScheduleClear(const juce::String& op, const juce::String& id) {
    std::scoped_lock lk(stateMutex);
    scheduler.clear();
    schedulerCursor = 0;
    if (schedulerDebug) juce::Logger::writeToLog("[SLS][engine.schedule.clear]");
    resOk(op, id, juce::var());
  }

  void handleScheduleSetWindow(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    std::scoped_lock lk(stateMutex);
    scheduleWindowFromPpq = getDoubleProp(d, "fromPpq", 0.0);
    scheduleWindowToPpq   = getDoubleProp(d, "toPpq",   0.0);
    if (schedulerDebug) {
      juce::Logger::writeToLog("[SLS][engine.schedule.setWindow] from=" + juce::String(scheduleWindowFromPpq) + " to=" + juce::String(scheduleWindowToPpq));
    }
    resOk(op, id, juce::var());
  }

  void handleSchedulePush(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d || !d->hasProperty("events") || !d->getProperty("events").isArray())
      return resErr(op, id, "E_BAD_REQUEST", "schedule.push events[] required");

    std::scoped_lock lk(stateMutex);

    for (const auto& ev : *d->getProperty("events").getArray()) {
      auto* eo = ev.getDynamicObject();
      if (!eo) continue;

      ScheduledEvent se;
      se.atPpq  = getDoubleProp(eo, "atPpq", 0.0);
      se.type   = getStringProp(eo, "type", "note.on");
      se.instId = getStringProp(eo, "instId", "global");
      se.mixCh  = getIntProp(eo, "mixCh", 1);
      se.note   = getIntProp(eo, "note", 60);
      se.vel    = (float)getDoubleProp(eo, "vel", getDoubleProp(eo, "velocity", 0.85));
      se.durPpq = getDoubleProp(eo, "durPpq", 0.25);
      se.payload = ev;

      scheduler.push_back(se);
    }

    std::sort(scheduler.begin(), scheduler.end(),
              [](const auto& a, const auto& b) { return a.atPpq < b.atPpq; });

    if (schedulerDebug) {
      juce::Logger::writeToLog("[SLS][engine.schedule.push] added=" + juce::String((int)d->getProperty("events").getArray()->size()) + " total=" + juce::String((int)scheduler.size()) + " cursor=" + juce::String((int)schedulerCursor));
    }
    resOk(op, id, juce::var());
  }

  void prepareBlockEvents(int nSamples) {
    blockEvents.clear();

    const double fromPpq = samplesToPpq(samplePos);
    const double toPpq   = samplesToPpq(samplePos + nSamples);

    std::scoped_lock lk(stateMutex);

    // Advance cursor through all events < toPpq and collect those in [fromPpq, toPpq)
    size_t cursor = schedulerCursor;

    while (cursor < scheduler.size()) {
      const auto& ev = scheduler[cursor];
      if (ev.atPpq >= toPpq) break;

      const bool inRange = (ev.atPpq >= fromPpq);
      const bool inWindow = (scheduleWindowToPpq <= scheduleWindowFromPpq) ||
                            (ev.atPpq >= scheduleWindowFromPpq && ev.atPpq <= scheduleWindowToPpq);

      if (inRange && inWindow) {
        const juce::int64 absSample = ppqToSamples(ev.atPpq);
        int offset = (int)(absSample - samplePos);
        if (offset < 0) offset = 0;
        if (offset >= nSamples) offset = nSamples - 1;

        blockEvents.push_back(BlockEvent{ offset, ev });
      }

      ++cursor;
    }

    // Update cursor to the first event >= toPpq
    while (schedulerCursor < scheduler.size() && scheduler[schedulerCursor].atPpq < toPpq)
      ++schedulerCursor;

    // Sort by offset so we can pop in order
    std::sort(blockEvents.begin(), blockEvents.end(),
              [](const BlockEvent& a, const BlockEvent& b) { return a.offset < b.offset; });
  }

  void dispatchOneEvent(const ScheduledEvent& ev) {
    // NOTE: this is called from audio thread under audioMutex.
    const auto t = ev.type.toLowerCase();

    if (t == "note.on" || t == "midi.noteon") {
      startVoice(ev.instId, ev.mixCh, ev.note, ev.vel);
      return;
    }

    if (t == "note.off" || t == "midi.noteoff") {
      stopVoice(ev.instId, ev.mixCh, ev.note);
      return;
    }

    if (t == "touski.note.on") {
      // Trigger sample voice using Touski mapping
      juce::DynamicObject* dummy = nullptr;
      (void)dummy;
      // Use existing mapping; use ev.instId as touski instId
      auto it = touskiNoteSamples.find(ev.instId);
      if (it == touskiNoteSamples.end() || it->second.empty()) return;

      int root = 60;
      std::shared_ptr<SampleData> chosen;
      int bestDist = 999999;
      for (const auto& kv : it->second) {
        const int dist = std::abs(kv.first - ev.note);
        if (dist < bestDist) { bestDist = dist; root = kv.first; chosen = kv.second; }
      }
      if (!chosen) return;

      SampleVoice sv;
      sv.active = true;
      sv.releasing = false;
      sv.instId = ev.instId;
      sv.note = ev.note;

      sv.sample = chosen;
      sv.start = 0;
      sv.end = chosen->buffer.getNumSamples();
      sv.pos = 0.0;

      const double pitchRatio = std::pow(2.0, (double)(ev.note - root) / 12.0);
      sv.rate = pitchRatio * (chosen->sampleRate / std::max(1.0, sampleRate));

      sv.gainL = ev.vel;
      sv.gainR = ev.vel;
      sv.mixCh = juce::jmax(1, ev.mixCh);

      for (auto& x : sampleVoices) { if (!x.active) { x = sv; return; } }
      if ((int)sampleVoices.size() < kMaxSampleVoices) sampleVoices.push_back(sv);
      return;
    }

    if (t == "touski.note.off") {
      stopSampleVoicesMatching(ev.instId, ev.mixCh, ev.note);
      return;
    }

    if (t == "sampler.trigger") {
      // Use ev.payload to trigger sample
      if (auto* p = ev.payload.getDynamicObject())
        triggerSampleFromObject(p, /*isFromScheduler*/true);
      return;
    }
  }

  // ------------------------------ Instruments ------------------------------

  void handleInstCreate(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data");
    const auto instId = getStringProp(d, "instId", "");
    if (instId.isEmpty()) return resErr(op, id, "E_BAD_REQUEST", "instId required");
    instruments[instId] = defaultsForType(getStringProp(d, "type", "piano"));
    resOk(op, id, juce::var());
  }

  void handleInstParamSet(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data");
    const auto instId = getStringProp(d, "instId", "");
    if (instId.isEmpty()) return resErr(op, id, "E_BAD_REQUEST", "instId required");

    auto it = instruments.find(instId);
    if (it == instruments.end())
      it = instruments.emplace(instId, defaultsForType(getStringProp(d, "type", "piano"))).first;

    auto& st = it->second;

    // allow type override
    if (d->hasProperty("type")) st.type = d->getProperty("type").toString();

    const auto* p = d->hasProperty("params") ? d->getProperty("params").getDynamicObject() : nullptr;
    if (p) {
      st.gain    = (float)std::max(0.0,   getDoubleProp(p, "gain",    st.gain));
      st.attack  = (float)std::max(0.001, getDoubleProp(p, "attack",  st.attack));
      st.decay   = (float)std::max(0.005, getDoubleProp(p, "decay",   st.decay));
      st.sustain = (float)juce::jlimit(0.0, 1.0, getDoubleProp(p, "sustain", st.sustain));
      st.release = (float)std::max(0.01,  getDoubleProp(p, "release", st.release));
      st.waveform = getIntProp(p, "waveform", st.waveform);
      st.fm = (float)getDoubleProp(p, "fm", st.fm);
    }

    if (d->hasProperty("juceSpec")) st.juceSpec = d->getProperty("juceSpec");

    resOk(op, id, juce::var());
  }

  // ------------------------------ Sampler / Sample Pattern ------------------------------

  void handleSamplerLoad(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data");

    const auto sampleId = getStringProp(d, "sampleId", "");
    const auto path = getStringProp(d, "path", "");

    auto sd = loadSampleFromPath(path);
    if (sampleId.isEmpty() || !sd) return resErr(op, id, "E_LOAD_FAIL", "Invalid sample");

    sampleCache[sampleId] = sd;
    resOk(op, id, juce::var());
  }

  void handleSamplerTrigger(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data");
    if (!triggerSampleFromObject(d, /*isFromScheduler*/false))
      return resErr(op, id, "E_TRIGGER_FAIL", "sampler.trigger failed");
    resOk(op, id, juce::var());
  }

  bool triggerSampleFromObject(const juce::DynamicObject* d, bool /*isFromScheduler*/) {
    // Required:
    //  - sampleId
    // Optional:
    //  - startNorm, endNorm
    //  - mode: "vinyl"|"fit_duration"|"fit_duration_vinyl"
    //  - note, rootMidi
    //  - velocity/gain/pan/mixCh
    //  - durationSec or patternSteps/patternBeats + bpm

    juce::String sampleId = getStringProp(d, "sampleId", "");
    auto it = sampleCache.find(sampleId);
    if (it == sampleCache.end()) {
      const auto samplePath = getStringProp(d, "samplePath", "");
      if (samplePath.isNotEmpty()) {
        auto loaded = loadSampleFromPath(samplePath);
        if (loaded) {
          if (sampleId.isEmpty()) sampleId = "adhoc:" + samplePath;
          sampleCache[sampleId] = loaded;
          it = sampleCache.find(sampleId);
        }
      }
    }
    if (it == sampleCache.end()) return false;

    const auto sd = it->second;
    const int total = sd->buffer.getNumSamples();
    if (total <= 1) return false;

    const double startNorm = juce::jlimit(0.0, 1.0, getDoubleProp(d, "startNorm", 0.0));
    const double endNorm   = juce::jlimit(0.0, 1.0, getDoubleProp(d, "endNorm",   1.0));

    int st = juce::jlimit(0, std::max(0, total - 2), (int)std::floor(startNorm * total));
    int en = juce::jlimit(st + 1, total,            (int)std::ceil (endNorm   * total));

    const auto mode = getStringProp(d, "mode", "vinyl").toLowerCase();
    const int note  = getIntProp(d, "note", 60);
    const int root  = getIntProp(d, "rootMidi", 60);

    const double pitchRatio = std::pow(2.0, (double)(note - root) / 12.0);

    // Default: vinyl
    double rate = pitchRatio;

    // Fit duration modes
    if (mode == "fit_duration" || mode == "fit_duration_vinyl") {
      double durationSec = getDoubleProp(d, "durationSec", 0.0);

      if (durationSec <= 0.0) {
        const double patternSteps = getDoubleProp(d, "patternSteps", 0.0);
        const double patternBeats = (patternSteps > 0.0)
          ? (patternSteps / (double)kStepsPerBeat)
          : getDoubleProp(d, "patternBeats", 0.0);

        const double reqBpm = std::max(20.0, getDoubleProp(d, "bpm", bpm.load()));
        if (patternBeats > 0.0) durationSec = (60.0 / reqBpm) * patternBeats;
      }

      if (durationSec > 0.0) {
        const double sliceLenSamples = (double)(en - st);
        const double baseRate = sliceLenSamples / std::max(1.0, durationSec * std::max(1.0, sampleRate));
        rate = (mode == "fit_duration_vinyl") ? (baseRate * pitchRatio) : baseRate;
      }
    }

    SampleVoice sv;
    sv.active = true;
    sv.releasing = false;
    sv.instId = "sampler";
    sv.note = note;

    sv.sample = sd;
    sv.start = st;
    sv.end = en;
    sv.pos = (double)st;

    // CRITICAL: compensate sample SR -> engine SR
    sv.rate = std::max(0.0001, rate * (sd->sampleRate / std::max(1.0, sampleRate)));

    const float vel = (float)juce::jlimit(0.0, 1.0, getDoubleProp(d, "velocity", getDoubleProp(d, "vel", 0.85)));
    const float gain = (float)std::max(0.0, getDoubleProp(d, "gain", 1.0));
    const int mixCh = juce::jmax(1, getIntProp(d, "mixCh", 1));
    const float pan = (float)juce::jlimit(-1.0, 1.0, getDoubleProp(d, "pan", 0.0));

    const float g = gain * vel;
    // simple pan for sample voice
    sv.gainL = g * (1.0f - pan);
    sv.gainR = g * (1.0f + pan);
    sv.mixCh = mixCh;

    for (auto& x : sampleVoices) {
      if (!x.active) { x = sv; return true; }
    }
    if ((int)sampleVoices.size() < kMaxSampleVoices) sampleVoices.push_back(sv);

    return true;
  }

  // ------------------------------ Touski ------------------------------

  void handleTouskiProgramLoad(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data");

    const auto instId = getStringProp(d, "instId", "touski");
    std::unordered_map<int, std::shared_ptr<SampleData>> mapping;

    auto appendSample = [&](int note, const juce::String& rawPath, const juce::File& baseDir) {
      juce::File file(rawPath);
      if (!file.isAbsolute()) file = baseDir.getChildFile(rawPath);
      auto sd = loadSampleFromPath(file.getFullPathName());
      if (sd) mapping[note] = sd;
    };

    if (d->hasProperty("samples") && d->getProperty("samples").isArray()) {
      for (const auto& item : *d->getProperty("samples").getArray()) {
        auto* o = item.getDynamicObject();
        if (!o) continue;
        const int note = getIntProp(o, "note", getIntProp(o, "rootMidi", 60));
        const auto path = getStringProp(o, "path", getStringProp(o, "samplePath", ""));
        if (path.isNotEmpty()) appendSample(note, path, juce::File());
      }
    }

    if (mapping.empty() && d->hasProperty("programPath")) {
      const auto programPath = getStringProp(d, "programPath", "");
      juce::File f(programPath);
      if (f.existsAsFile()) {
        const juce::File baseDir = f.getParentDirectory();
        juce::var v = juce::JSON::parse(f.loadFileAsString());
        if (auto* root = v.getDynamicObject()) {
          auto readMappingArray = [&](const juce::String& key) {
            auto vv = root->getProperty(key);
            if (!vv.isArray()) return;
            for (const auto& item : *vv.getArray()) {
              auto* o = item.getDynamicObject();
              if (!o) continue;
              const int note = getIntProp(o, "note", getIntProp(o, "rootMidi", 60));
              juce::String path = getStringProp(o, "path", "");
              if (path.isEmpty() && o->hasProperty("sample")) {
                if (auto* so = o->getProperty("sample").getDynamicObject()) {
                  path = getStringProp(so, "path", getStringProp(so, "relativePath", ""));
                }
              }
              if (path.isEmpty()) path = getStringProp(o, "relativePath", "");
              if (path.isNotEmpty()) appendSample(note, path, baseDir);
            }
          };

          readMappingArray("zones");
          readMappingArray("samples");
          readMappingArray("mapping");

          if (mapping.empty() && root->hasProperty("sample")) {
            int rootMidi = getIntProp(root, "rootMidi", 60);
            if (auto* so = root->getProperty("sample").getDynamicObject()) {
              const auto path = getStringProp(so, "path", getStringProp(so, "relativePath", ""));
              if (path.isNotEmpty()) appendSample(rootMidi, path, baseDir);
            }
          }
        }
      }
    }

    if (mapping.empty())
      return resErr(op, id, "E_LOAD_FAIL", "No samples in touski program");

    touskiNoteSamples[instId] = std::move(mapping);
    resOk(op, id, juce::var());
  }

  void handleTouskiNoteOn(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data");

    const auto instId = getStringProp(d, "instId", "touski");
    const int note = getIntProp(d, "note", 60);
    const int mixCh = juce::jmax(1, getIntProp(d, "mixCh", 1));
    const float vel = (float)juce::jlimit(0.0, 1.0, getDoubleProp(d, "vel", getDoubleProp(d, "velocity", 0.85)));

    auto it = touskiNoteSamples.find(instId);
    if (it == touskiNoteSamples.end() || it->second.empty())
      return resErr(op, id, "E_NOT_LOADED", "Touski program not loaded");

    int root = 60;
    std::shared_ptr<SampleData> chosen;
    int bestDist = 999999;

    for (const auto& kv : it->second) {
      const int dist = std::abs(kv.first - note);
      if (dist < bestDist) { bestDist = dist; root = kv.first; chosen = kv.second; }
    }

    if (!chosen) return resErr(op, id, "E_NOT_FOUND", "No sample for note");

    SampleVoice sv;
    sv.active = true;
    sv.releasing = false;
    sv.instId = instId;
    sv.note = note;

    sv.sample = chosen;
    sv.start = 0;
    sv.end = chosen->buffer.getNumSamples();
    sv.pos = 0.0;

    const double pitchRatio = std::pow(2.0, (double)(note - root) / 12.0);
    sv.rate = pitchRatio * (chosen->sampleRate / std::max(1.0, sampleRate));

    sv.gainL = vel;
    sv.gainR = vel;
    sv.mixCh = mixCh;

    for (auto& x : sampleVoices) {
      if (!x.active) { x = sv; resOk(op, id, juce::var()); return; }
    }
    if ((int)sampleVoices.size() < kMaxSampleVoices) sampleVoices.push_back(sv);

    resOk(op, id, juce::var());
  }

  void handleTouskiNoteOff(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data");
    const auto instId = getStringProp(d, "instId", "touski");
    const int note = getIntProp(d, "note", 60);
    const int mixCh = juce::jmax(1, getIntProp(d, "mixCh", 1));
    stopSampleVoicesMatching(instId, mixCh, note);
    resOk(op, id, juce::var());
  }

  // ------------------------------ Mixer ------------------------------

  void handleMixerParamSet(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data");

    const auto scope = getStringProp(d, "scope", "master");
    const auto param = getStringProp(d, "param", "gain");
    const float value = (float)getDoubleProp(d, "value", 0.0);

    if (scope == "master") {
      if (param == "gain") masterGain = std::max(0.0f, value);
      else if (param == "crossfader") crossfader = juce::jlimit(-1.0f, 1.0f, value);

      resOk(op, id, juce::var());
      return;
    }

    const int ch = juce::jlimit(0, channelCount - 1, getIntProp(d, "ch", 0));
    auto& m = mixerStates[(size_t)ch];

    if (param == "gain") m.gain = std::max(0.0f, value);
    else if (param == "pan") m.pan = juce::jlimit(-1.0f, 1.0f, value);
    else if (param == "eqLow") m.eqLow = value;
    else if (param == "eqMid") m.eqMid = value;
    else if (param == "eqHigh") m.eqHigh = value;
    else if (param == "mute") m.mute = value >= 0.5f;
    else if (param == "solo") m.solo = value >= 0.5f;

    // Refresh EQ when any eq param changes (safe to call anyway)
    refreshEqForChannel(ch);

    resOk(op, id, juce::var());
  }

  // Compatibility: older calls { gain: ... }
  void handleMixerCompatMaster(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data");
    if (d->hasProperty("gain")) masterGain = (float)std::max(0.0, getDoubleProp(d, "gain", masterGain));
    if (d->hasProperty("crossfader")) crossfader = (float)juce::jlimit(-1.0, 1.0, getDoubleProp(d, "crossfader", crossfader));
    resOk(op, id, juce::var());
  }

  void handleMixerCompatChannel(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data");
    const int ch = juce::jlimit(0, channelCount - 1, getIntProp(d, "ch", 0));
    auto& m = mixerStates[(size_t)ch];

    if (d->hasProperty("gain")) m.gain = (float)std::max(0.0, getDoubleProp(d, "gain", m.gain));
    if (d->hasProperty("pan"))  m.pan  = (float)juce::jlimit(-1.0, 1.0, getDoubleProp(d, "pan", m.pan));
    if (d->hasProperty("mute")) m.mute = (bool)d->getProperty("mute");
    if (d->hasProperty("solo")) m.solo = (bool)d->getProperty("solo");

    if (d->hasProperty("eqLow"))  m.eqLow  = (float)getDoubleProp(d, "eqLow",  m.eqLow);
    if (d->hasProperty("eqMid"))  m.eqMid  = (float)getDoubleProp(d, "eqMid",  m.eqMid);
    if (d->hasProperty("eqHigh")) m.eqHigh = (float)getDoubleProp(d, "eqHigh", m.eqHigh);

    refreshEqForChannel(ch);
    resOk(op, id, juce::var());
  }

  // ------------------------------ Meter ------------------------------

  void handleMeterSubscribe(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    meterSubscribed = true;
    meterFps = juce::jlimit(1, 60, getIntProp(d, "fps", 30));
    meterChannels.clear();

    if (d && d->hasProperty("channels") && d->getProperty("channels").isArray()) {
      for (const auto& v : *d->getProperty("channels").getArray())
        meterChannels.insert((int)v);
    }

    if (meterChannels.empty()) meterChannels.insert(-1);
    resOk(op, id, juce::var());
  }

  void handleMeterUnsubscribe(const juce::String& op, const juce::String& id) {
    meterSubscribed = false;
    meterChannels.clear();
    resOk(op, id, juce::var());
  }

  juce::var meterData() {
    juce::Array<juce::var> frames;

    auto addFrame = [&](int ch, float rL, float rR, float pL, float pR) {
      juce::DynamicObject::Ptr f = new juce::DynamicObject();
      juce::Array<juce::var> rms { rL, rR };
      juce::Array<juce::var> peak { pL, pR };
      f->setProperty("ch", ch);
      f->setProperty("rms", juce::var(rms));
      f->setProperty("peak", juce::var(peak));
      frames.add(juce::var(f.get()));
    };

    if (meterChannels.count(-1))
      addFrame(-1, meterRmsL, meterRmsR, meterPeakL, meterPeakR);

    for (int ch = 0; ch < channelCount; ++ch) {
      if (!meterChannels.count(ch)) continue;

      addFrame(ch,
               meterChRmsL[(size_t)ch], meterChRmsR[(size_t)ch],
               meterChPeakL[(size_t)ch], meterChPeakR[(size_t)ch]);

      // reset peaks for reported channels
      meterChPeakL[(size_t)ch] = 0.0f;
      meterChPeakR[(size_t)ch] = 0.0f;
    }

    juce::DynamicObject::Ptr d = new juce::DynamicObject();
    d->setProperty("frames", juce::var(frames));

    // reset master peaks after reporting
    meterPeakL = 0.0f;
    meterPeakR = 0.0f;

    return juce::var(d.get());
  }

  // ------------------------------ JSON I/O ------------------------------

  void write(const juce::var& v) {
    std::scoped_lock lk(ioMutex);
    std::cout << juce::JSON::toString(v, true).toStdString() << "\n";
    std::cout.flush();
  }

  void resOk(const juce::String& op, const juce::String& id, const juce::var& data) {
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty("v", 1);
    o->setProperty("type", "res");
    o->setProperty("op", op);
    o->setProperty("id", id);
    o->setProperty("ts", nowMs());
    o->setProperty("ok", true);
    o->setProperty("data", data);
    write(juce::var(o.get()));
  }

  void resErr(const juce::String& op, const juce::String& id, const juce::String& code, const juce::String& message) {
    juce::DynamicObject::Ptr e = new juce::DynamicObject();
    e->setProperty("code", code);
    e->setProperty("message", message);

    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty("v", 1);
    o->setProperty("type", "res");
    o->setProperty("op", op);
    o->setProperty("id", id);
    o->setProperty("ts", nowMs());
    o->setProperty("ok", false);
    o->setProperty("err", juce::var(e.get()));
    write(juce::var(o.get()));
  }

  void emitEvt(const juce::String& op, const juce::var& data) {
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty("v", 1);
    o->setProperty("type", "evt");
    o->setProperty("op", op);
    o->setProperty("id", "evt-" + juce::String(nowMs()));
    o->setProperty("ts", nowMs());
    o->setProperty("data", data);
    write(juce::var(o.get()));
  }

  // ------------------------------ State snapshots ------------------------------

  juce::var helloData() {
    juce::DynamicObject::Ptr caps = new juce::DynamicObject();
    caps->setProperty("webaudioFallback", false);
    caps->setProperty("projectSync", true);
    caps->setProperty("scheduler", true);
    caps->setProperty("mixer", true);
    caps->setProperty("fx", true);
    caps->setProperty("meters", true);
    caps->setProperty("touski", true);
    caps->setProperty("sampler", true);

    juce::DynamicObject::Ptr d = new juce::DynamicObject();
    d->setProperty("protocol", "SLS-IPC/1.0");
    d->setProperty("engineName", "sls-audio-engine");
    d->setProperty("engineVersion", "0.3.0");
    d->setProperty("platform", juce::SystemStats::getOperatingSystemName());
    d->setProperty("pid", SLS_GET_PID());
    d->setProperty("capabilities", juce::var(caps.get()));
    return juce::var(d.get());
  }

  juce::var engineState() {
    juce::DynamicObject::Ptr d = new juce::DynamicObject();
    d->setProperty("ready", ready);
    d->setProperty("sampleRate", sampleRate);
    d->setProperty("bufferSize", bufferSize);
    d->setProperty("cpuLoad", 0.0);
    d->setProperty("xruns", 0);
    return juce::var(d.get());
  }

  juce::var engineConfig() {
    juce::DynamicObject::Ptr d = new juce::DynamicObject();
    d->setProperty("sampleRate", sampleRate);
    d->setProperty("bufferSize", bufferSize);
    d->setProperty("numOut", numOut);
    d->setProperty("numIn", numIn);
    d->setProperty("channels", channelCount);
    d->setProperty("playPrerollMs", playPrerollMs.load());
    d->setProperty("schedulerDebug", schedulerDebug);
    return juce::var(d.get());
  }

  juce::var transportState() {
    juce::DynamicObject::Ptr d = new juce::DynamicObject();
    d->setProperty("playing", playing.load() || playArmed.load());
    d->setProperty("bpm", bpm.load());
    d->setProperty("ppq", samplesToPpq(samplePos));
    d->setProperty("samplePos", (int)samplePos);
    return juce::var(d.get());
  }

  // ------------------------------ Event pump thread ------------------------------

  void pumpEvents() {
    // Emit transport.state regularly so UI can be engine-authoritative.
    // Emit meter.level at requested fps.
    juce::int64 lastTransport = 0;
    juce::int64 lastMeter = 0;

    while (running.load()) {
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
      const auto t = nowMs();

      if (t - lastTransport >= 50) { // 20 Hz
        lastTransport = t;
        emitEvt("transport.state", transportState());
      }

      if (meterSubscribed) {
        const int ms = std::max(1, 1000 / std::max(1, meterFps));
        if (t - lastMeter >= ms) {
          lastMeter = t;
          emitEvt("meter.level", meterData());
        }
      }
    }
  }
};

} // namespace

int main() {
  Engine engine;
  std::string line;

  while (engine.isRunning() && std::getline(std::cin, line)) {
    if (line.empty()) continue;
    juce::var msg;
    if (juce::JSON::parse(line, msg).wasOk())
      engine.handle(msg);
  }
  return 0;
}