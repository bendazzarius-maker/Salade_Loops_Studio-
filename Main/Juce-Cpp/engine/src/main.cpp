#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <iostream>
#include <map>
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
constexpr int kMaxSynthVoices = 64;
constexpr int kMaxSampleVoices = 128;
constexpr int kStepsPerBeat = 16;

juce::int64 nowMs() { return juce::Time::currentTimeMillis(); }

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
  std::shared_ptr<const SampleData> sample;
  int start = 0;
  int end = 0;
  double pos = 0.0;
  double rate = 1.0;
  float gainL = 1.0f;
  float gainR = 1.0f;
  int mixCh = 1;
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
  float pan = 0.0f;
  float eqLow = 0.0f;
  float eqMid = 0.0f;
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
    if (v.isInt() || v.isDouble()) return (float) (double) v;
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

static double getDoubleProp(const juce::DynamicObject* o, const char* key, double def) {
  if (!o) return def;
  const auto v = o->getProperty(key);
  return (v.isInt() || v.isDouble()) ? (double) v : def;
}

static int getIntProp(const juce::DynamicObject* o, const char* key, int def) {
  return (int) std::llround(getDoubleProp(o, key, def));
}

static juce::String getStringProp(const juce::DynamicObject* o, const char* key, const juce::String& def = {}) {
  if (!o) return def;
  const auto v = o->getProperty(key);
  return v.isString() ? v.toString() : def;
}

class Engine : public juce::AudioIODeviceCallback {
public:
  Engine() {
    formatManager.registerBasicFormats();
    mixerStates.resize((size_t) channelCount);
    channelDsp.resize((size_t) channelCount);
    resizeMeters(channelCount);
    setupAudio();
    refreshDspSpecs();
    stateThread = std::thread([this] { pumpEvents(); });
    emitEvt("engine.state", engineState());
    emitEvt("transport.state", transportState());
  }

  ~Engine() override {
    running = false;
    if (stateThread.joinable()) stateThread.join();
    shutdownAudio();
  }

  bool isRunning() const { return running.load(); }

  void handle(const juce::var& msg) {
    auto* obj = msg.getDynamicObject();
    if (!obj || obj->getProperty("type").toString() != "req") return;

    const auto op = obj->getProperty("op").toString();
    const auto id = obj->getProperty("id").toString();
    const auto data = obj->getProperty("data");
    const auto* d = data.getDynamicObject();

    if (op == "engine.hello") return resOk(op, id, helloData());
    if (op == "engine.ping") return resOk(op, id, data);
    if (op == "engine.state.get") return resOk(op, id, engineState());
    if (op == "engine.config.get") return resOk(op, id, engineConfig());
    if (op == "engine.config.set") return handleEngineConfigSet(op, id, d);

    if (op == "project.sync") return handleProjectSync(op, id, d, data);
    if (op == "mixer.init") return handleMixerInit(op, id, d);
    if (op == "schedule.clear") return handleScheduleClear(op, id);
    if (op == "schedule.setWindow") return handleScheduleSetWindow(op, id, d);
    if (op == "schedule.push") return handleSchedulePush(op, id, d);

    if (op == "transport.play") {
      playing.store(true);
      resOk(op, id, juce::var());
      return emitEvt("transport.state", transportState());
    }
    if (op == "transport.stop") {
      playing.store(false);
      panic();
      resOk(op, id, juce::var());
      return emitEvt("transport.state", transportState());
    }
    if (op == "transport.seek") {
      std::scoped_lock lk(stateMutex);
      const bool hasSamplePos = d && d->hasProperty("samplePos");
      samplePos = hasSamplePos ? (juce::int64) getDoubleProp(d, "samplePos", 0.0) : ppqToSamples(getDoubleProp(d, "ppq", 0.0));
      schedulerCursor = 0;
      while (schedulerCursor < scheduler.size() && scheduler[schedulerCursor].atPpq < samplesToPpq(samplePos)) ++schedulerCursor;
      resOk(op, id, juce::var());
      return emitEvt("transport.state", transportState());
    }
    if (op == "transport.setTempo") {
      bpm.store(std::max(20.0, getDoubleProp(d, "bpm", bpm.load())));
      resOk(op, id, juce::var());
      return emitEvt("transport.state", transportState());
    }
    if (op == "transport.state.get") return resOk(op, id, transportState());

    if (op == "inst.create") return handleInstCreate(op, id, d);
    if (op == "inst.param.set") return handleInstParamSet(op, id, d);

    if (op == "note.on") {
      startVoice(getStringProp(d, "instId", "global"), getIntProp(d, "mixCh", 1), getIntProp(d, "note", 60), (float) getDoubleProp(d, "vel", getDoubleProp(d, "velocity", 0.85)));
      return resOk(op, id, juce::var());
    }
    if (op == "note.off") {
      stopVoice(getStringProp(d, "instId", "global"), getIntProp(d, "mixCh", 1), getIntProp(d, "note", 60));
      return resOk(op, id, juce::var());
    }
    if (op == "note.allOff") {
      panic();
      return resOk(op, id, juce::var());
    }

    if (op == "touski.program.load") return handleTouskiProgramLoad(op, id, d);
    if (op == "touski.param.set") return resOk(op, id, juce::var());
    if (op == "touski.note.on") return handleTouskiNoteOn(op, id, d);
    if (op == "touski.note.off") {
      stopVoice(getStringProp(d, "instId", "touski"), getIntProp(d, "mixCh", 1), getIntProp(d, "note", 60));
      return resOk(op, id, juce::var());
    }

    if (op == "sampler.load") return handleSamplerLoad(op, id, d);
    if (op == "sampler.trigger") return handleSamplerTrigger(op, id, d);

    if (op == "mixer.param.set") return handleMixerParamSet(op, id, d);
    if (op == "mixer.master.set") return handleMixerCompatMaster(op, id, d);
    if (op == "mixer.channel.set") return handleMixerCompatChannel(op, id, d);
    if (op == "fx.chain.set" || op == "fx.param.set" || op == "fx.bypass.set") return handleFxSetOp(op, id, d);

    if (op == "meter.subscribe") {
      meterSubscribed = true;
      meterFps = juce::jlimit(1, 60, getIntProp(d, "fps", 30));
      meterChannels.clear();
      if (d && d->hasProperty("channels") && d->getProperty("channels").isArray()) {
        for (const auto& v : *d->getProperty("channels").getArray()) meterChannels.insert((int) v);
      }
      if (meterChannels.empty()) meterChannels.insert(-1);
      return resOk(op, id, juce::var());
    }
    if (op == "meter.unsubscribe") {
      meterSubscribed = false;
      meterChannels.clear();
      return resOk(op, id, juce::var());
    }

    resErr(op, id, "E_UNKNOWN_OP", "Unknown opcode");
  }

  void audioDeviceAboutToStart(juce::AudioIODevice* d) override {
    if (!d) return;
    sampleRate = d->getCurrentSampleRate();
    bufferSize = d->getCurrentBufferSizeSamples();
    ready = true;
    refreshDspSpecs();
  }

  void audioDeviceStopped() override {}

  void audioDeviceIOCallbackWithContext(const float* const*, int, float* const* out, int outChs, int n, const juce::AudioIODeviceCallbackContext&) override {
    std::scoped_lock lk(audioMutex);
    for (int ch = 0; ch < outChs; ++ch) if (out[ch]) juce::FloatVectorOperations::clear(out[ch], n);

    const bool transportPlaying = playing.load();
    if (transportPlaying) dispatchScheduledEventsForBlock(n);

    const size_t chCount = (size_t) juce::jmax(1, channelCount);
    std::vector<float> busL(chCount, 0.0f), busR(chCount, 0.0f);

    for (int i = 0; i < n; ++i) {
      std::fill(busL.begin(), busL.end(), 0.0f);
      std::fill(busR.begin(), busR.end(), 0.0f);
      bool anySolo = false;
      for (const auto& mc : mixerStates) if (mc.solo) { anySolo = true; break; }

      for (auto& sv : sampleVoices) {
        if (!sv.active || !sv.sample) continue;
        const auto& b = sv.sample->buffer;
        const int ip = (int) sv.pos;
        if (ip >= sv.end || ip >= b.getNumSamples() - 1) { sv.active = false; continue; }
        const float frac = (float) (sv.pos - ip);
        float inL = b.getSample(0, ip) + (b.getSample(0, ip + 1) - b.getSample(0, ip)) * frac;
        float inR = (b.getNumChannels() > 1) ? (b.getSample(1, ip) + (b.getSample(1, ip + 1) - b.getSample(1, ip)) * frac) : inL;
        int idx = juce::jlimit(0, (int) mixerStates.size() - 1, sv.mixCh - 1);
        const auto& mc = mixerStates[(size_t) idx];
        if (mc.mute || (anySolo && !mc.solo)) { sv.pos += sv.rate; continue; }
        busL[(size_t) idx] += inL * sv.gainL;
        busR[(size_t) idx] += inR * sv.gainR;
        sv.pos += sv.rate;
      }

      for (auto& v : voices) {
        if (!v.active) continue;
        const int atkS = std::max(1, (int) std::llround(v.attack * sampleRate));
        const int decS = std::max(1, (int) std::llround(v.decay * sampleRate));
        const int relS = std::max(1, (int) std::llround(v.release * sampleRate));
        if (!v.releasing) {
          if (v.ageSamples < atkS) v.env = (float) v.ageSamples / (float) atkS;
          else if (v.ageSamples < atkS + decS) {
            const float t = (float) (v.ageSamples - atkS) / (float) decS;
            v.env = 1.0f - (1.0f - v.sustain) * t;
          } else v.env = v.sustain;
        } else {
          const float mul = std::exp(std::log(0.0001f) / (float) relS);
          v.env *= mul;
          if (v.env < 0.0001f) { v.active = false; continue; }
        }

        const float sig = (float) std::sin(v.phase);
        v.phase += v.phaseInc;
        if (v.phase > kTwoPi) v.phase -= kTwoPi;

        int idx = juce::jlimit(0, (int) mixerStates.size() - 1, v.mixCh - 1);
        const auto& mc = mixerStates[(size_t) idx];
        if (mc.mute || (anySolo && !mc.solo)) { ++v.ageSamples; continue; }

        const float amp = sig * v.velocity * v.gain * v.env * 0.2f;
        busL[(size_t) idx] += amp;
        busR[(size_t) idx] += amp;
        ++v.ageSamples;
      }

      float L = 0.0f, R = 0.0f;
      for (int ch = 0; ch < channelCount; ++ch) {
        float cl = busL[(size_t) ch];
        float cr = busR[(size_t) ch];
        channelDsp[(size_t) ch].processEq(cl, cr);
        processFxChain(channelDsp[(size_t) ch].fx, cl, cr);

        const auto& m = mixerStates[(size_t) ch];
        cl *= m.gain * masterGain;
        cr *= m.gain * masterGain;
        const float pan = juce::jlimit(-1.0f, 1.0f, m.pan);
        const float outL = cl * (1.0f - pan);
        const float outR = cr * (1.0f + pan);

        meterChPeakL[(size_t) ch] = std::max(meterChPeakL[(size_t) ch], std::abs(outL));
        meterChPeakR[(size_t) ch] = std::max(meterChPeakR[(size_t) ch], std::abs(outR));
        meterChRmsAccL[(size_t) ch] += outL * outL;
        meterChRmsAccR[(size_t) ch] += outR * outR;

        L += outL;
        R += outR;
      }

      processFxChain(masterFx, L, R);
      if (outChs > 0 && out[0]) out[0][i] = L;
      if (outChs > 1 && out[1]) out[1][i] = R;
      meterPeakL = std::max(meterPeakL, std::abs(L));
      meterPeakR = std::max(meterPeakR, std::abs(R));
      meterRmsAccL += L * L;
      meterRmsAccR += R * R;
    }

    samplePos += n;
    meterRmsL = (float) std::sqrt(meterRmsAccL / std::max(1, n));
    meterRmsR = (float) std::sqrt(meterRmsAccR / std::max(1, n));
    meterRmsAccL = 0.0;
    meterRmsAccR = 0.0;
    for (size_t i = 0; i < meterChRmsAccL.size(); ++i) {
      meterChRmsL[i] = (float) std::sqrt(meterChRmsAccL[i] / std::max(1, n));
      meterChRmsR[i] = (float) std::sqrt(meterChRmsAccR[i] / std::max(1, n));
      meterChRmsAccL[i] = 0.0;
      meterChRmsAccR[i] = 0.0;
    }
  }

private:
  juce::AudioDeviceManager deviceManager;
  juce::AudioFormatManager formatManager;

  std::mutex ioMutex;
  std::mutex audioMutex;
  std::mutex stateMutex;

  std::atomic<bool> running { true };
  std::atomic<bool> playing { false };
  std::atomic<double> bpm { 120.0 };
  std::thread stateThread;

  bool ready = false;
  double sampleRate = 48000.0;
  int bufferSize = 512;
  int channelCount = 16;
  int numOut = 2;
  int numIn = 0;
  float masterGain = 0.85f;

  juce::int64 samplePos = 0;

  std::vector<Voice> voices;
  std::vector<SampleVoice> sampleVoices;
  std::unordered_map<juce::String, std::shared_ptr<SampleData>> sampleCache;
  std::unordered_map<juce::String, InstrumentState> instruments;
  std::unordered_map<juce::String, std::unordered_map<int, std::shared_ptr<SampleData>>> touskiNoteSamples;

  std::vector<MixerChannelState> mixerStates;
  std::vector<ChannelDSP> channelDsp;
  std::vector<std::unique_ptr<FxUnit>> masterFx;

  std::vector<ScheduledEvent> scheduler;
  size_t schedulerCursor = 0;
  double scheduleWindowFromPpq = 0.0;
  double scheduleWindowToPpq = 0.0;
  juce::var lastProjectSync;

  bool meterSubscribed = false;
  int meterFps = 30;
  std::unordered_set<int> meterChannels;
  float meterPeakL = 0.0f, meterPeakR = 0.0f;
  float meterRmsL = 0.0f, meterRmsR = 0.0f;
  double meterRmsAccL = 0.0, meterRmsAccR = 0.0;
  std::vector<float> meterChPeakL, meterChPeakR, meterChRmsL, meterChRmsR;
  std::vector<double> meterChRmsAccL, meterChRmsAccR;

  void setupAudio() {
    deviceManager.initialise(numIn, numOut, nullptr, true, {}, nullptr);
    deviceManager.addAudioCallback(this);
  }

  void shutdownAudio() {
    deviceManager.removeAudioCallback(this);
    deviceManager.closeAudioDevice();
  }

  void resizeMeters(int channels) {
    meterChPeakL.assign((size_t) channels, 0.0f);
    meterChPeakR.assign((size_t) channels, 0.0f);
    meterChRmsL.assign((size_t) channels, 0.0f);
    meterChRmsR.assign((size_t) channels, 0.0f);
    meterChRmsAccL.assign((size_t) channels, 0.0);
    meterChRmsAccR.assign((size_t) channels, 0.0);
  }

  static InstrumentState defaultsForType(const juce::String& type) {
    InstrumentState st;
    st.type = type;
    return st;
  }

  double samplesToPpq(juce::int64 samples) const {
    const double bps = bpm.load() / 60.0;
    return (double) samples / sampleRate * bps;
  }

  juce::int64 ppqToSamples(double ppq) const {
    const double bps = bpm.load() / 60.0;
    return (juce::int64) std::llround((ppq / std::max(1e-9, bps)) * sampleRate);
  }

  void refreshEqForChannel(int ch) {
    if (ch < 0 || ch >= (int) channelDsp.size() || ch >= (int) mixerStates.size()) return;
    auto& dsp = channelDsp[(size_t) ch];
    const auto& m = mixerStates[(size_t) ch];
    const auto sr = std::max(22050.0, sampleRate);

    dsp.lowL.coefficients = juce::dsp::IIR::Coefficients<float>::makeLowShelf(sr, 120.0, 0.707f, juce::Decibels::decibelsToGain(m.eqLow));
    dsp.lowR.coefficients = juce::dsp::IIR::Coefficients<float>::makeLowShelf(sr, 120.0, 0.707f, juce::Decibels::decibelsToGain(m.eqLow));
    dsp.midL.coefficients = juce::dsp::IIR::Coefficients<float>::makePeakFilter(sr, 1200.0, 0.9f, juce::Decibels::decibelsToGain(m.eqMid));
    dsp.midR.coefficients = juce::dsp::IIR::Coefficients<float>::makePeakFilter(sr, 1200.0, 0.9f, juce::Decibels::decibelsToGain(m.eqMid));
    dsp.highL.coefficients = juce::dsp::IIR::Coefficients<float>::makeHighShelf(sr, 8000.0, 0.707f, juce::Decibels::decibelsToGain(m.eqHigh));
    dsp.highR.coefficients = juce::dsp::IIR::Coefficients<float>::makeHighShelf(sr, 8000.0, 0.707f, juce::Decibels::decibelsToGain(m.eqHigh));

    dsp.lowL.reset(); dsp.lowR.reset(); dsp.midL.reset(); dsp.midR.reset(); dsp.highL.reset(); dsp.highR.reset();
  }

  void refreshDspSpecs() {
    juce::dsp::ProcessSpec spec { sampleRate, (juce::uint32) juce::jmax(1, bufferSize), 1 };
    for (int ch = 0; ch < channelCount; ++ch) {
      auto& d = channelDsp[(size_t) ch];
      d.lowL.prepare(spec); d.lowR.prepare(spec); d.midL.prepare(spec); d.midR.prepare(spec); d.highL.prepare(spec); d.highR.prepare(spec);
      refreshEqForChannel(ch);
    }
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
        p.damping = juce::jlimit(0.0f, 1.0f, u.getParam("damping", 0.45f));
        p.wetLevel = juce::jlimit(0.0f, 1.0f, u.getParam("mix", 0.25f));
        p.dryLevel = 1.0f;
        p.width = juce::jlimit(0.0f, 1.0f, u.getParam("width", 1.0f));
        u.reverb.setParameters(p);
        u.reverb.processStereo(&l, &r, 1);
      } else if (type.contains("delay")) {
        const float t = juce::jlimit(0.01f, 1.5f, u.getParam("time", 0.24f));
        const float fb = juce::jlimit(0.0f, 0.95f, u.getParam("feedback", 0.3f));
        const int delaySamp = (int) std::llround(t * sampleRate);
        const int idx = delayIndex++ % (int) delayBufferL.size();
        const int ridx = (idx - delaySamp + (int) delayBufferL.size()) % (int) delayBufferL.size();
        const float dl = delayBufferL[(size_t) ridx];
        const float dr = delayBufferR[(size_t) ridx];
        delayBufferL[(size_t) idx] = l + dl * fb;
        delayBufferR[(size_t) idx] = r + dr * fb;
        const float wet = juce::jlimit(0.0f, 1.0f, u.getParam("mix", 0.25f));
        l = l * (1.0f - wet) + dl * wet;
        r = r * (1.0f - wet) + dr * wet;
      }
    }
  }


  void startVoice(const juce::String& instId, int mixCh, int note, float velocity) {
    auto it = instruments.find(instId);
    if (it == instruments.end()) it = instruments.emplace(instId, defaultsForType("piano")).first;
    const auto& st = it->second;

    Voice v;
    v.active = true;
    v.instId = instId;
    v.mixCh = juce::jmax(1, mixCh);
    v.note = note;
    v.velocity = juce::jlimit(0.0f, 1.0f, velocity);
    v.gain = st.gain;
    v.attack = st.attack;
    v.decay = st.decay;
    v.sustain = st.sustain;
    v.release = st.release;
    const double hz = 440.0 * std::pow(2.0, (note - 69) / 12.0);
    v.phaseInc = kTwoPi * hz / std::max(1.0, sampleRate);

    for (auto& s : voices) {
      if (!s.active) { s = v; return; }
    }
    if ((int) voices.size() < kMaxSynthVoices) voices.push_back(v);
  }

  void stopVoice(const juce::String& instId, int mixCh, int note) {
    for (auto& v : voices) {
      if (!v.active) continue;
      if (v.instId == instId && v.mixCh == mixCh && v.note == note) v.releasing = true;
    }
  }

  void panic() {
    for (auto& v : voices) v.active = false;
    for (auto& sv : sampleVoices) sv.active = false;
  }

  std::shared_ptr<SampleData> loadSampleFromPath(const juce::String& p) {
    juce::File f(p);
    if (p.isEmpty() || !f.existsAsFile()) return {};
    auto r = std::unique_ptr<juce::AudioFormatReader>(formatManager.createReaderFor(f));
    if (!r) return {};
    auto sd = std::make_shared<SampleData>();
    sd->sampleRate = r->sampleRate;
    sd->buffer.setSize((int) r->numChannels, (int) r->lengthInSamples);
    r->read(&sd->buffer, 0, (int) r->lengthInSamples, 0, true, true);
    return sd;
  }


  void handleEngineConfigSet(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    sampleRate = std::max(22050.0, getDoubleProp(d, "sampleRate", sampleRate));
    bufferSize = std::max(64, getIntProp(d, "bufferSize", bufferSize));
    numOut = std::max(1, getIntProp(d, "numOut", numOut));
    numIn = std::max(0, getIntProp(d, "numIn", numIn));
    shutdownAudio();
    setupAudio();
    refreshDspSpecs();
    resOk(op, id, engineConfig());
  }

  void handleMixerInit(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    channelCount = juce::jlimit(1, 64, getIntProp(d, "channels", channelCount));
    mixerStates.resize((size_t) channelCount);
    channelDsp.resize((size_t) channelCount);
    resizeMeters(channelCount);
    refreshDspSpecs();
    resOk(op, id, juce::var());
  }

  void handleProjectSync(const juce::String& op, const juce::String& id, const juce::DynamicObject*, const juce::var& fullData) {
    std::scoped_lock lk(stateMutex);
    lastProjectSync = fullData;
    resOk(op, id, juce::var());
  }

  void handleScheduleClear(const juce::String& op, const juce::String& id) {
    std::scoped_lock lk(stateMutex);
    scheduler.clear();
    schedulerCursor = 0;
    resOk(op, id, juce::var());
  }

  void handleScheduleSetWindow(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    std::scoped_lock lk(stateMutex);
    scheduleWindowFromPpq = getDoubleProp(d, "fromPpq", 0.0);
    scheduleWindowToPpq = getDoubleProp(d, "toPpq", 0.0);
    resOk(op, id, juce::var());
  }

  void handleSchedulePush(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d || !d->hasProperty("events") || !d->getProperty("events").isArray()) return resErr(op, id, "E_BAD_REQUEST", "schedule.push events[] required");
    std::scoped_lock lk(stateMutex);
    for (const auto& ev : *d->getProperty("events").getArray()) {
      auto* eo = ev.getDynamicObject();
      if (!eo) continue;
      ScheduledEvent se;
      se.atPpq = getDoubleProp(eo, "atPpq", 0.0);
      se.type = getStringProp(eo, "type", "note.on");
      se.instId = getStringProp(eo, "instId", "global");
      se.mixCh = getIntProp(eo, "mixCh", 1);
      se.note = getIntProp(eo, "note", 60);
      se.vel = (float) getDoubleProp(eo, "vel", getDoubleProp(eo, "velocity", 0.85));
      se.durPpq = getDoubleProp(eo, "durPpq", 0.25);
      se.payload = ev;
      scheduler.push_back(se);
    }
    std::sort(scheduler.begin(), scheduler.end(), [](const auto& a, const auto& b) { return a.atPpq < b.atPpq; });
    resOk(op, id, juce::var());
  }

  void dispatchScheduledEventsForBlock(int nSamples) {
    std::vector<ScheduledEvent> toDispatch;
    const double from = samplesToPpq(samplePos);
    const double to = samplesToPpq(samplePos + nSamples);
    {
      std::scoped_lock lk(stateMutex);
      while (schedulerCursor < scheduler.size()) {
        const auto& ev = scheduler[schedulerCursor];
        if (ev.atPpq >= to) break;
        if (ev.atPpq >= from && (scheduleWindowToPpq <= scheduleWindowFromPpq || (ev.atPpq >= scheduleWindowFromPpq && ev.atPpq <= scheduleWindowToPpq))) {
          toDispatch.push_back(ev);
        }
        ++schedulerCursor;
      }
    }

    for (const auto& ev : toDispatch) {
      if (ev.type == "note.on" || ev.type == "touski.note.on") {
        startVoice(ev.instId, ev.mixCh, ev.note, ev.vel);
      } else if (ev.type == "note.off" || ev.type == "touski.note.off") {
        stopVoice(ev.instId, ev.mixCh, ev.note);
      }
    }
  }

  void handleInstCreate(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    const auto instId = getStringProp(d, "instId", "");
    if (instId.isEmpty()) return resErr(op, id, "E_BAD_REQUEST", "instId required");
    instruments[instId] = defaultsForType(getStringProp(d, "type", "piano"));
    resOk(op, id, juce::var());
  }

  void handleInstParamSet(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    const auto instId = getStringProp(d, "instId", "");
    if (instId.isEmpty()) return resErr(op, id, "E_BAD_REQUEST", "instId required");
    auto it = instruments.find(instId);
    if (it == instruments.end()) it = instruments.emplace(instId, defaultsForType(getStringProp(d, "type", "piano"))).first;
    auto& st = it->second;
    const auto* p = d ? d->getProperty("params").getDynamicObject() : nullptr;
    st.gain = (float) std::max(0.0, getDoubleProp(p, "gain", st.gain));
    st.attack = (float) std::max(0.001, getDoubleProp(p, "attack", st.attack));
    st.decay = (float) std::max(0.005, getDoubleProp(p, "decay", st.decay));
    st.sustain = (float) juce::jlimit(0.0, 1.0, getDoubleProp(p, "sustain", st.sustain));
    st.release = (float) std::max(0.01, getDoubleProp(p, "release", st.release));
    st.waveform = getIntProp(p, "waveform", st.waveform);
    if (d && d->hasProperty("juceSpec")) st.juceSpec = d->getProperty("juceSpec");
    resOk(op, id, juce::var());
  }

  void handleSamplerLoad(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    const auto sampleId = getStringProp(d, "sampleId", "");
    const auto path = getStringProp(d, "path", "");
    auto sd = loadSampleFromPath(path);
    if (sampleId.isEmpty() || !sd) return resErr(op, id, "E_LOAD_FAIL", "Invalid sample");
    sampleCache[sampleId] = sd;
    resOk(op, id, juce::var());
  }

  void handleSamplerTrigger(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    auto it = sampleCache.find(getStringProp(d, "sampleId", ""));
    if (it == sampleCache.end()) return resErr(op, id, "E_NOT_LOADED", "sampleId not loaded");
    const auto sd = it->second;
    const int total = sd->buffer.getNumSamples();
    int st = juce::jlimit(0, std::max(0, total - 2), (int) std::floor(getDoubleProp(d, "startNorm", 0.0) * total));
    int en = juce::jlimit(st + 1, total, (int) std::ceil(getDoubleProp(d, "endNorm", 1.0) * total));

    const auto mode = getStringProp(d, "mode", "vinyl");
    const int note = getIntProp(d, "note", 60);
    const int root = getIntProp(d, "rootMidi", 60);
    const double pitchRatio = std::pow(2.0, (double) (note - root) / 12.0);
    double rate = pitchRatio;

    if (mode == "fit_duration" || mode == "fit_duration_vinyl") {
      double durationSec = getDoubleProp(d, "durationSec", 0.0);
      if (durationSec <= 0.0) {
        const double patternSteps = getDoubleProp(d, "patternSteps", 0.0);
        const double patternBeats = (patternSteps > 0.0) ? (patternSteps / kStepsPerBeat) : getDoubleProp(d, "patternBeats", 0.0);
        const double reqBpm = std::max(20.0, getDoubleProp(d, "bpm", bpm.load()));
        if (patternBeats > 0.0) durationSec = (60.0 / reqBpm) * patternBeats;
      }
      if (durationSec > 0.0) {
        const double sliceLenSamples = (double) (en - st);
        const double baseRate = sliceLenSamples / std::max(1.0, durationSec * sampleRate);
        rate = (mode == "fit_duration_vinyl") ? (baseRate * pitchRatio) : baseRate;
      }
    }

    SampleVoice sv;
    sv.active = true;
    sv.sample = sd;
    sv.start = st;
    sv.end = en;
    sv.pos = (double) st;
    sv.rate = std::max(0.0001, rate * (sd->sampleRate / std::max(1.0, sampleRate)));
    const float vel = (float) juce::jlimit(0.0, 1.0, getDoubleProp(d, "velocity", 0.85));
    const float gain = (float) std::max(0.0, getDoubleProp(d, "gain", 1.0));
    sv.gainL = gain * vel;
    sv.gainR = gain * vel;
    sv.mixCh = juce::jmax(1, getIntProp(d, "mixCh", 1));

    for (auto& x : sampleVoices) {
      if (!x.active) { x = sv; resOk(op, id, juce::var()); return; }
    }
    if ((int) sampleVoices.size() < kMaxSampleVoices) sampleVoices.push_back(sv);
    resOk(op, id, juce::var());
  }

  void handleTouskiProgramLoad(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    const auto instId = getStringProp(d, "instId", "touski");
    std::unordered_map<int, std::shared_ptr<SampleData>> mapping;

    if (d && d->hasProperty("samples") && d->getProperty("samples").isArray()) {
      for (const auto& it : *d->getProperty("samples").getArray()) {
        const auto* o = it.getDynamicObject();
        if (!o) continue;
        auto sd = loadSampleFromPath(getStringProp(o, "path", ""));
        if (!sd) continue;
        mapping[getIntProp(o, "note", 60)] = sd;
      }
    }

    if (mapping.empty()) {
      const auto programPath = getStringProp(d, "programPath", "");
      juce::File f(programPath);
      if (f.existsAsFile()) {
        auto v = juce::JSON::parse(f.loadFileAsString());
        if (auto* root = v.getDynamicObject()) {
          const auto zones = root->getProperty("zones");
          if (zones.isArray()) {
            for (const auto& z : *zones.getArray()) {
              auto* zo = z.getDynamicObject();
              if (!zo) continue;
              const int note = getIntProp(zo, "note", getIntProp(zo, "rootMidi", 60));
              const auto path = getStringProp(zo, "path", getStringProp(zo, "samplePath", ""));
              auto sd = loadSampleFromPath(path);
              if (sd) mapping[note] = sd;
            }
          }
        }
      }
    }

    if (mapping.empty()) return resErr(op, id, "E_LOAD_FAIL", "No samples in touski program");
    touskiNoteSamples[instId] = std::move(mapping);
    resOk(op, id, juce::var());
  }

  void handleTouskiNoteOn(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    const auto instId = getStringProp(d, "instId", "touski");
    const int note = getIntProp(d, "note", 60);
    const int mixCh = juce::jmax(1, getIntProp(d, "mixCh", 1));
    const float vel = (float) juce::jlimit(0.0, 1.0, getDoubleProp(d, "vel", getDoubleProp(d, "velocity", 0.85)));

    auto it = touskiNoteSamples.find(instId);
    if (it == touskiNoteSamples.end() || it->second.empty()) return resErr(op, id, "E_NOT_LOADED", "Touski program not loaded");

    int root = 60;
    std::shared_ptr<SampleData> chosen;
    int bestDist = 9999;
    for (const auto& kv : it->second) {
      const int dist = std::abs(kv.first - note);
      if (dist < bestDist) { bestDist = dist; root = kv.first; chosen = kv.second; }
    }
    if (!chosen) return resErr(op, id, "E_NOT_FOUND", "No sample for note");

    SampleVoice sv;
    sv.active = true;
    sv.sample = chosen;
    sv.start = 0;
    sv.end = chosen->buffer.getNumSamples();
    sv.pos = 0.0;
    sv.rate = std::pow(2.0, (double) (note - root) / 12.0) * (chosen->sampleRate / std::max(1.0, sampleRate));
    sv.gainL = vel;
    sv.gainR = vel;
    sv.mixCh = mixCh;

    for (auto& x : sampleVoices) {
      if (!x.active) { x = sv; resOk(op, id, juce::var()); return; }
    }
    if ((int) sampleVoices.size() < kMaxSampleVoices) sampleVoices.push_back(sv);
    resOk(op, id, juce::var());
  }

  std::vector<std::unique_ptr<FxUnit>>& resolveFxTarget(const juce::DynamicObject* d) {
    if (d && d->hasProperty("target")) {
      if (auto* t = d->getProperty("target").getDynamicObject()) {
        if (getStringProp(t, "scope", "master") == "ch") {
          const int ch = juce::jlimit(0, channelCount - 1, getIntProp(t, "ch", 0));
          return channelDsp[(size_t) ch].fx;
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
          u->enabled = !o->hasProperty("enabled") || (bool) o->getProperty("enabled");
          list.push_back(std::move(u));
        }
      }
    } else if (op == "fx.param.set") {
      const auto fxId = getStringProp(d, "id", "fx");
      auto* fx = findFx(list, fxId);
      if (!fx) {
        auto u = std::make_unique<FxUnit>();
        u->id = fxId;
        u->type = getStringProp(d, "type", "reverb");
        fx = u.get();
        list.push_back(std::move(u));
      }
      if (d && d->hasProperty("params")) {
        if (auto* p = d->getProperty("params").getDynamicObject()) fx->params = p->getProperties();
      }
    } else if (op == "fx.bypass.set") {
      const auto fxId = getStringProp(d, "id", "fx");
      if (auto* fx = findFx(list, fxId)) fx->bypass = (bool) d->getProperty("bypass");
    }
    resOk(op, id, juce::var());
  }

  void handleMixerParamSet(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data");
    const auto scope = getStringProp(d, "scope", "master");
    const auto param = getStringProp(d, "param", "gain");
    const float value = (float) getDoubleProp(d, "value", 0.0);

    if (scope == "master") {
      if (param == "gain") masterGain = std::max(0.0f, value);
      if (param == "crossfader") crossfader = juce::jlimit(-1.0f, 1.0f, value);
      resOk(op, id, juce::var());
      return;
    }

    const int ch = juce::jlimit(0, channelCount - 1, getIntProp(d, "ch", 0));
    auto& m = mixerStates[(size_t) ch];
    if (param == "gain") m.gain = std::max(0.0f, value);
    else if (param == "pan") m.pan = juce::jlimit(-1.0f, 1.0f, value);
    else if (param == "eqLow") m.eqLow = value;
    else if (param == "eqMid") m.eqMid = value;
    else if (param == "eqHigh") m.eqHigh = value;
    else if (param == "mute") m.mute = value >= 0.5f;
    else if (param == "solo") m.solo = value >= 0.5f;
    refreshEqForChannel(ch);
    resOk(op, id, juce::var());
  }


  void handleMixerCompatMaster(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data");
    if (d->hasProperty("gain")) masterGain = (float) std::max(0.0, getDoubleProp(d, "gain", masterGain));
    resOk(op, id, juce::var());
  }

  void handleMixerCompatChannel(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    if (!d) return resErr(op, id, "E_BAD_REQUEST", "Missing data");
    const int ch = juce::jlimit(0, channelCount - 1, getIntProp(d, "ch", 0));
    auto& m = mixerStates[(size_t) ch];
    m.gain = (float) std::max(0.0, getDoubleProp(d, "gain", m.gain));
    m.pan = (float) juce::jlimit(-1.0, 1.0, getDoubleProp(d, "pan", m.pan));
    m.mute = d->hasProperty("mute") ? (bool) d->getProperty("mute") : m.mute;
    m.solo = d->hasProperty("solo") ? (bool) d->getProperty("solo") : m.solo;
    refreshEqForChannel(ch);
    resOk(op, id, juce::var());
  }

  juce::var helloData() {
    juce::DynamicObject::Ptr caps = new juce::DynamicObject();
    caps->setProperty("webaudioFallback", false);
    caps->setProperty("projectSync", true);
    caps->setProperty("scheduler", true);

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
    return juce::var(d.get());
  }

  juce::var transportState() {
    juce::DynamicObject::Ptr d = new juce::DynamicObject();
    d->setProperty("playing", playing.load());
    d->setProperty("bpm", bpm.load());
    d->setProperty("ppq", samplesToPpq(samplePos));
    d->setProperty("samplePos", (int) samplePos);
    return juce::var(d.get());
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

    if (meterChannels.count(-1)) addFrame(-1, meterRmsL, meterRmsR, meterPeakL, meterPeakR);
    for (int ch = 0; ch < channelCount; ++ch) {
      if (!meterChannels.count(ch)) continue;
      addFrame(ch, meterChRmsL[(size_t) ch], meterChRmsR[(size_t) ch], meterChPeakL[(size_t) ch], meterChPeakR[(size_t) ch]);
      meterChPeakL[(size_t) ch] = 0.0f;
      meterChPeakR[(size_t) ch] = 0.0f;
    }

    juce::DynamicObject::Ptr d = new juce::DynamicObject();
    d->setProperty("frames", juce::var(frames));
    meterPeakL = 0.0f;
    meterPeakR = 0.0f;
    return juce::var(d.get());
  }

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

  void pumpEvents() {
    while (running.load()) {
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
      emitEvt("transport.state", transportState());
      if (meterSubscribed) {
        const int ms = std::max(1, 1000 / std::max(1, meterFps));
        emitEvt("meter.level", meterData());
        std::this_thread::sleep_for(std::chrono::milliseconds(ms));
      }
    }
  }

  float crossfader = 0.0f;
  mutable int delayIndex = 0;
  std::array<float, 192000> delayBufferL{};
  std::array<float, 192000> delayBufferR{};
};
} // namespace

int main() {
  Engine engine;
  std::string line;
  while (engine.isRunning() && std::getline(std::cin, line)) {
    if (line.empty()) continue;
    juce::var msg;
    if (juce::JSON::parse(line, msg).wasOk()) engine.handle(msg);
  }
  return 0;
}
