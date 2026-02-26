#include <array>
#include <atomic>
#include <cmath>
#include <iostream>
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
juce::int64 nowMs() { return juce::Time::currentTimeMillis(); }

struct Voice {
  int note = 60;
  float velocity = 0.8f;
  double phase = 0.0, phaseInc = 0.0;
  double modPhase = 0.0, modPhaseInc = 0.0;
  float fmAmount = 0.0f, gain = 1.0f;
  float attack = 0.003f, decay = 0.12f, sustain = 0.7f, release = 0.2f;
  float env = 0.0f;
  int ageSamples = 0;
  bool releasing = false;
  juce::String instId = "global";
  int mixCh = 1;
  int waveform = 0;
  bool drum = false;
  int drumKind = 0; // 0=kick,1=snare,2=hatC,3=hatO,4=crash
  float drumNoise = 0.0f, drumStartHz = 150.0f, drumEndHz = 50.0f;
  bool active = false;
};

struct SampleData { double sampleRate = 48000.0; juce::AudioBuffer<float> buffer; };

struct SampleVoice {
  std::shared_ptr<const SampleData> sample;
  int start = 0, end = 0;
  double pos = 0.0, rate = 1.0;
  float gainL = 1.0f, gainR = 1.0f;
  int mixCh = 1;
  bool active = false;
};

struct InstrumentState {
  juce::String type = "piano";
  float gain = 1.0f;
  float attack = 0.003f, decay = 0.12f, sustain = 0.7f, release = 0.2f;
  float fm = 0.0f, tone = 12000.0f;
  int waveform = 0;
  bool drumMode = false;
  juce::var juceSpec;
};

struct MixerChannelState {
  float gain = 0.85f;
  float pan = 0.0f;
  float eqLow = 0.0f, eqMid = 0.0f, eqHigh = 0.0f;
  bool mute = false;
  bool solo = false;
};

struct FxUnit {
  juce::String id;
  juce::String type = "";
  bool enabled = true;
  bool bypass = false;
  juce::NamedValueSet params;

  juce::dsp::Reverb reverb;
  juce::dsp::Compressor<float> comp;
  juce::dsp::DelayLine<float, juce::dsp::DelayLineInterpolationTypes::Linear> delayL{ 192000 }, delayR{ 192000 };
  juce::dsp::DelayLine<float, juce::dsp::DelayLineInterpolationTypes::Linear> modL{ 192000 }, modR{ 192000 };
  double lfoPhase = 0.0;

  float param(const juce::String& k, float def) const {
    const auto v = params.getWithDefault(k, def);
    if (v.isDouble() || v.isInt()) return (float) (double) v;
    return def;
  }
};

struct ChannelDSP {
  juce::dsp::IIR::Filter<float> lowL, lowR, midL, midR, highL, highR;
  std::vector<FxUnit> fx;

  void processEq(float& l, float& r) {
    l = highL.processSample(midL.processSample(lowL.processSample(l)));
    r = highR.processSample(midR.processSample(lowR.processSample(r)));
  }
};

static double getDoubleProp(const juce::DynamicObject* o, const char* key, double def){ if(!o) return def; const auto v=o->getProperty(key); return (v.isInt()||v.isDouble())?(double)v:def; }
static int getIntProp(const juce::DynamicObject* o, const char* key, int def){ return (int) std::llround(getDoubleProp(o,key,def)); }
static juce::String getStringProp(const juce::DynamicObject* o, const char* key, const juce::String& def={}){ if(!o) return def; const auto v=o->getProperty(key); return v.isString()?v.toString():def; }

class Engine : public juce::AudioIODeviceCallback {
public:
  Engine(){
    formatManager.registerBasicFormats();
    mixerStates.resize((size_t)channelCount);
    channelDsp.resize((size_t)channelCount);
    resizeMeters(channelCount);
    setupAudio();
    refreshDspSpecs();
    emitEvt("engine.state", engineState());
    emitEvt("transport.state", transportState());
    stateThread = std::thread([this]{pumpEvents();});
  }

  ~Engine() override { running=false; if(stateThread.joinable()) stateThread.join(); shutdownAudio(); }
  bool isRunning() const { return running.load(); }

  void handle(const juce::var& msg){
    auto* obj = msg.getDynamicObject(); if(!obj || obj->getProperty("type").toString() != "req") return;
    const auto op = obj->getProperty("op").toString(); const auto id = obj->getProperty("id").toString(); const auto data = obj->getProperty("data"); const auto* d = data.getDynamicObject();

    if(op=="engine.hello") return resOk(op,id,helloData());
    if(op=="engine.ping") return resOk(op,id,data);
    if(op=="engine.state.get"||op=="engine.getState") return resOk(op,id,engineState());
    if(op=="engine.config.get") return resOk(op,id,engineConfig());
    if(op=="engine.config.set"||op=="engine.setConfig"){
      sampleRate = std::max(22050.0, getDoubleProp(d,"sampleRate",sampleRate)); bufferSize = std::max(64,getIntProp(d,"bufferSize",bufferSize));
      numOut=std::max(1,getIntProp(d,"numOut",numOut)); numIn=std::max(0,getIntProp(d,"numIn",numIn));
      shutdownAudio(); setupAudio(); refreshDspSpecs();
      resOk(op,id,engineConfig()); emitEvt("engine.state", engineState()); return;
    }
    if(op=="engine.shutdown"){ running=false; return resOk(op,id,juce::var()); }

    if(op=="project.sync") return resOk(op,id,juce::var());

    if(op=="mixer.init"){
      channelCount = juce::jlimit(1,64,getIntProp(d,"channels",16));
      mixerStates.resize((size_t)channelCount);
      channelDsp.resize((size_t)channelCount);
      resizeMeters(channelCount);
      refreshDspSpecs();
      return resOk(op,id,juce::var());
    }

    if(op=="mixer.master.set"||op=="mixer.channel.set") return handleMixerSetOp(op,id,d);
    if(op=="fx.chain.set"||op=="fx.param.set"||op=="fx.bypass.set") return handleFxSetOp(op,id,d);
    if(op=="mixer.route.set") return resOk(op,id,juce::var());

    if(op=="inst.create") return handleInstCreate(op,id,d);
    if(op=="inst.param.set") return handleInstParamSet(op,id,d);
    if(op=="inst.delete"){ if(d) instruments.erase(getStringProp(d,"instId","")); return resOk(op,id,juce::var()); }

    if(op=="touski.program.load") return handleTouskiProgramLoad(op,id,d);
    if(op=="touski.param.set") return resOk(op,id,juce::var());
    if(op=="touski.note.on") return handleTouskiNoteOn(op,id,d);
    if(op=="touski.note.off") return resOk(op,id,juce::var());
    if(op=="touski.sample.preload") return resOk(op,id,juce::var());

    if(op=="transport.play"){ playing=true; resOk(op,id,juce::var()); return emitEvt("transport.state", transportState()); }
    if(op=="transport.stop"){ playing=false; panic(); resOk(op,id,juce::var()); return emitEvt("transport.state", transportState()); }
    if(op=="transport.setTempo"){ bpm=std::max(20.0,getDoubleProp(d,"bpm",bpm)); resOk(op,id,juce::var()); return emitEvt("transport.state", transportState()); }
    if(op=="transport.seek"){
      const bool hasSamplePos = d && d->hasProperty("samplePos"); samplePos = hasSamplePos ? (juce::int64)getDoubleProp(d,"samplePos",0.0) : ppqToSamples(getDoubleProp(d,"ppq",0.0));
      resOk(op,id,juce::var()); return emitEvt("transport.state", transportState());
    }
    if(op=="transport.state.get"||op=="transport.getState") return resOk(op,id,transportState());
    if(op=="transport.setLoop"){ loopEnabled = d && (bool)d->getProperty("enabled"); loopPpqStart=getDoubleProp(d,"ppqStart",loopPpqStart); loopPpqEnd=getDoubleProp(d,"ppqEnd",loopPpqEnd); resOk(op,id,juce::var()); return emitEvt("transport.state", transportState()); }

    if(op=="meter.subscribe"){ meterSubscribed=true; meterFps=juce::jlimit(1,60,getIntProp(d,"fps",30)); meterChannels.clear(); if(d&&d->hasProperty("channels")&&d->getProperty("channels").isArray()){ for(const auto& ch:*d->getProperty("channels").getArray()) meterChannels.insert((int)ch);} if(meterChannels.empty()) meterChannels.insert(-1); return resOk(op,id,juce::var()); }
    if(op=="meter.unsubscribe"){ meterSubscribed=false; meterChannels.clear(); return resOk(op,id,juce::var()); }

    if(op=="sampler.load") return handleSamplerLoad(op,id,d);
    if(op=="sampler.trigger") return handleSamplerTrigger(op,id,d);
    if(op=="sampler.unload"){ if(d) sampleCache.erase(getStringProp(d,"sampleId","")); return resOk(op,id,juce::var()); }

    if(op=="note.on"||op=="midi.noteOn"||op=="touski.note.on"){ startVoice(getStringProp(d,"instId","global"), getIntProp(d,"mixCh",1), getIntProp(d,"note",60),(float)getDoubleProp(d,"vel",getDoubleProp(d,"velocity",0.8))); return resOk(op,id,juce::var()); }
    if(op=="note.off"||op=="midi.noteOff"||op=="touski.note.off"){ stopVoice(getStringProp(d,"instId","global"), getIntProp(d,"mixCh",1), getIntProp(d,"note",60)); return resOk(op,id,juce::var()); }
    if(op=="note.allOff"||op=="midi.panic"){ panic(); return resOk(op,id,juce::var()); }

    return resErr(op,id,"E_UNKNOWN_OP","Unknown opcode");
  }

  void audioDeviceIOCallbackWithContext(const float* const*, int, float* const* out, int chs, int n, const juce::AudioIODeviceCallbackContext&) override {
    juce::ScopedLock sl(audioLock);
    for(int ch=0; ch<chs; ++ch) if(out[ch]) juce::FloatVectorOperations::clear(out[ch], n);

    bool hasActiveVoices = false;
    for(const auto& v : voices){ if(v.active){ hasActiveVoices = true; break; } }
    if(!hasActiveVoices){ for(const auto& sv : sampleVoices){ if(sv.active){ hasActiveVoices = true; break; } } }
    if(!playing && !hasActiveVoices) return;

    const size_t chCount = (size_t) juce::jmax(1, channelCount);
    std::vector<float> busL(chCount, 0.0f), busR(chCount, 0.0f);

    for(int i=0;i<n;++i){
      std::fill(busL.begin(), busL.end(), 0.0f);
      std::fill(busR.begin(), busR.end(), 0.0f);
      bool anySolo=false; for(const auto& mc:mixerStates) if(mc.solo){ anySolo=true; break; }

      for(auto& sv: sampleVoices){
        if(!sv.active||!sv.sample) continue;
        const auto& b=sv.sample->buffer; const int ip=(int)sv.pos;
        if(ip>=sv.end||ip>=b.getNumSamples()-1){sv.active=false; continue;}
        const float frac=(float)(sv.pos-ip);
        const float inL=b.getSample(0,ip)+(b.getSample(0,ip+1)-b.getSample(0,ip))*frac;
        float inR=inL;
        if(b.getNumChannels()>1) inR=b.getSample(1,ip)+(b.getSample(1,ip+1)-b.getSample(1,ip))*frac;

        int idx=juce::jmax(0,sv.mixCh-1); if(idx>=(int)mixerStates.size()) idx=0;
        const auto& mc=mixerStates[(size_t)idx];
        if(mc.mute || (anySolo && !mc.solo)){ sv.pos+=sv.rate; continue; }
        busL[(size_t)idx] += inL * sv.gainL;
        busR[(size_t)idx] += inR * sv.gainR;
        sv.pos+=sv.rate;
      }

      for(auto& v:voices){
        if(!v.active) continue;
        const int atkS=std::max(1,(int)std::llround(v.attack*sampleRate)); const int decS=std::max(1,(int)std::llround(v.decay*sampleRate)); const int relS=std::max(1,(int)std::llround(v.release*sampleRate));
        if(!v.releasing){ if(v.ageSamples<atkS) v.env=(float)v.ageSamples/(float)atkS; else if(v.ageSamples<atkS+decS){ const float t=(float)(v.ageSamples-atkS)/(float)decS; v.env=1.0f-(1.0f-v.sustain)*t; } else v.env=v.sustain; }
        else { const float mul=std::exp(std::log(0.0001f)/(float)relS); v.env*=mul; if(v.env<0.0002f){ v.active=false; continue; } }

        float sig=0.0f;
        if(v.drum){
          const float prog=(float)juce::jlimit(0.0,1.0,v.ageSamples/(sampleRate*0.15));
          float curHz=v.drumStartHz + (v.drumEndHz-v.drumStartHz)*prog;
          if(v.drumKind==2||v.drumKind==3||v.drumKind==4) curHz=8000.0f;
          const double inc=kTwoPi*curHz/std::max(1.0,sampleRate); v.phase += inc; if(v.phase>kTwoPi) v.phase-=kTwoPi;
          const float tonal=(float)std::sin(v.phase);
          const float noise=((float)rng.nextDouble()*2.0f-1.0f);
          if(v.drumKind==0) sig = tonal * (1.0f-prog*0.4f);
          else if(v.drumKind==1) sig = tonal*0.3f + noise*0.8f;
          else sig = noise * (v.drumKind==4 ? 0.7f : 0.5f);
        } else {
          const float mod=(float)std::sin(v.modPhase)*v.fmAmount;
          sig=waveSample(v.waveform, v.phase+mod);
          v.phase += v.phaseInc; v.modPhase += v.modPhaseInc;
          if(v.phase>kTwoPi) v.phase-=kTwoPi; if(v.modPhase>kTwoPi) v.modPhase-=kTwoPi;
        }

        int idx=juce::jmax(0,v.mixCh-1); if(idx>=(int)mixerStates.size()) idx=0;
        const auto& mc=mixerStates[(size_t)idx];
        if(mc.mute || (anySolo && !mc.solo)){ ++v.ageSamples; continue; }
        const float amp=sig*v.velocity*v.gain*v.env*0.2f;
        busL[(size_t)idx] += amp;
        busR[(size_t)idx] += amp;
        ++v.ageSamples;
      }

      float L=0.0f,R=0.0f;
      for(int ch=0; ch<channelCount; ++ch){
        auto& m = mixerStates[(size_t)ch];
        float cl = busL[(size_t)ch];
        float cr = busR[(size_t)ch];

        channelDsp[(size_t)ch].processEq(cl, cr);
        processFxChain(channelDsp[(size_t)ch].fx, cl, cr);

        cl *= m.gain * masterGain;
        cr *= m.gain * masterGain;
        const float pan=juce::jlimit(-1.0f,1.0f,m.pan);
        const float outL=cl*(1.0f-pan);
        const float outR=cr*(1.0f+pan);

        meterChPeakL[(size_t)ch]=std::max(meterChPeakL[(size_t)ch], std::abs(outL));
        meterChPeakR[(size_t)ch]=std::max(meterChPeakR[(size_t)ch], std::abs(outR));
        meterChRmsAccL[(size_t)ch] += (double)outL*(double)outL;
        meterChRmsAccR[(size_t)ch] += (double)outR*(double)outR;

        L += outL; R += outR;
      }

      processFxChain(masterFx, L, R);

      if(chs>0&&out[0]) out[0][i]=L;
      if(chs>1&&out[1]) out[1][i]=R;
      meterPeakL = std::max(meterPeakL, std::abs(L)); meterPeakR = std::max(meterPeakR, std::abs(R)); meterRmsAccL += L*L; meterRmsAccR += R*R;
    }

    samplePos += n;
    if(loopEnabled && loopPpqEnd>loopPpqStart){ const auto le=ppqToSamples(loopPpqEnd); if(samplePos>=le) samplePos=ppqToSamples(loopPpqStart); }
    meterRmsL = (float) std::sqrt(meterRmsAccL / std::max(1,n)); meterRmsR = (float) std::sqrt(meterRmsAccR / std::max(1,n)); meterRmsAccL=0; meterRmsAccR=0;
    for(size_t i=0;i<meterChRmsAccL.size();++i){ meterChRmsL[i]=(float)std::sqrt(meterChRmsAccL[i]/std::max(1,n)); meterChRmsR[i]=(float)std::sqrt(meterChRmsAccR[i]/std::max(1,n)); meterChRmsAccL[i]=0.0; meterChRmsAccR[i]=0.0; }
  }

  void audioDeviceAboutToStart(juce::AudioIODevice* d) override { if(d){ sampleRate=d->getCurrentSampleRate(); bufferSize=d->getCurrentBufferSizeSamples(); ready=true; refreshDspSpecs(); } }
  void audioDeviceStopped() override {}

private:
  juce::AudioDeviceManager deviceManager; juce::AudioFormatManager formatManager; juce::CriticalSection audioLock;
  std::vector<Voice> voices; std::vector<SampleVoice> sampleVoices;
  std::unordered_map<juce::String,std::shared_ptr<SampleData>> sampleCache;
  std::unordered_map<juce::String,InstrumentState> instruments;

  std::unordered_map<juce::String, std::unordered_map<int, std::shared_ptr<SampleData>>> touskiNoteSamples;

  std::vector<ChannelDSP> channelDsp;
  std::vector<FxUnit> masterFx;

  std::atomic<bool> running{true}; std::thread stateThread;
  bool ready=false, playing=false, loopEnabled=false;
  double bpm=120.0, sampleRate=48000.0, loopPpqStart=0.0, loopPpqEnd=16.0;
  int bufferSize=512, numOut=2, numIn=0, channelCount=16;
  float masterGain=0.85f;
  std::vector<MixerChannelState> mixerStates;

  juce::int64 samplePos=0; bool meterSubscribed=false; int meterFps=30; std::unordered_set<int> meterChannels;
  float meterPeakL=0,meterPeakR=0,meterRmsL=0,meterRmsR=0; double meterRmsAccL=0,meterRmsAccR=0;
  std::vector<float> meterChPeakL, meterChPeakR, meterChRmsL, meterChRmsR;
  std::vector<double> meterChRmsAccL, meterChRmsAccR;

  juce::Random rng;
  juce::var lastMixerSpec;
  std::unordered_map<juce::String, juce::var> fxSpecCache;

  void resizeMeters(int channels){
    meterChPeakL.assign((size_t)channels,0.0f); meterChPeakR.assign((size_t)channels,0.0f);
    meterChRmsL.assign((size_t)channels,0.0f); meterChRmsR.assign((size_t)channels,0.0f);
    meterChRmsAccL.assign((size_t)channels,0.0); meterChRmsAccR.assign((size_t)channels,0.0);
  }

  void refreshEqForChannel(int ch){
    if(ch<0 || ch>=(int)channelDsp.size() || ch>=(int)mixerStates.size()) return;
    auto& dsp = channelDsp[(size_t)ch];
    const auto& m = mixerStates[(size_t)ch];
    const auto sr = std::max(22050.0, sampleRate);

    *dsp.lowL.state = *juce::dsp::IIR::Coefficients<float>::makeLowShelf(sr, 120.0, 0.707, juce::Decibels::decibelsToGain(m.eqLow));
    *dsp.lowR.state = *juce::dsp::IIR::Coefficients<float>::makeLowShelf(sr, 120.0, 0.707, juce::Decibels::decibelsToGain(m.eqLow));
    *dsp.midL.state = *juce::dsp::IIR::Coefficients<float>::makePeakFilter(sr, 1200.0, 0.9, juce::Decibels::decibelsToGain(m.eqMid));
    *dsp.midR.state = *juce::dsp::IIR::Coefficients<float>::makePeakFilter(sr, 1200.0, 0.9, juce::Decibels::decibelsToGain(m.eqMid));
    *dsp.highL.state = *juce::dsp::IIR::Coefficients<float>::makeHighShelf(sr, 8000.0, 0.707, juce::Decibels::decibelsToGain(m.eqHigh));
    *dsp.highR.state = *juce::dsp::IIR::Coefficients<float>::makeHighShelf(sr, 8000.0, 0.707, juce::Decibels::decibelsToGain(m.eqHigh));
  }

  void refreshDspSpecs(){
    juce::dsp::ProcessSpec spec{ sampleRate, (juce::uint32) juce::jmax(1, bufferSize), 1 };
    for (int ch=0; ch<channelCount; ++ch){
      if((int)channelDsp.size()<=ch) channelDsp.resize((size_t)(ch+1));
      auto& d = channelDsp[(size_t)ch];
      d.lowL.prepare(spec); d.lowR.prepare(spec); d.midL.prepare(spec); d.midR.prepare(spec); d.highL.prepare(spec); d.highR.prepare(spec);
      d.lowL.reset(); d.lowR.reset(); d.midL.reset(); d.midR.reset(); d.highL.reset(); d.highR.reset();
      refreshEqForChannel(ch);
    }
  }

  void processFxChain(std::vector<FxUnit>& fx, float& l, float& r){
    for(auto& u : fx){
      if(!u.enabled || u.bypass) continue;
      const auto type = u.type.toLowerCase();
      if(type.contains("reverb")){
        juce::dsp::Reverb::Parameters p;
        p.roomSize = juce::jlimit(0.0f,1.0f,u.param("roomSize",0.35f));
        p.damping = juce::jlimit(0.0f,1.0f,u.param("damping",0.45f));
        p.wetLevel = juce::jlimit(0.0f,1.0f,u.param("mix",0.25f));
        p.dryLevel = 1.0f - p.wetLevel*0.5f;
        p.width = juce::jlimit(0.0f,1.0f,u.param("width",1.0f));
        u.reverb.setParameters(p);
        u.reverb.processStereo(&l, &r, 1);
      } else if(type.contains("compressor")){
        u.comp.setThreshold(u.param("threshold", -18.0f));
        u.comp.setRatio(juce::jlimit(1.0f,20.0f,u.param("ratio", 3.0f)));
        u.comp.setAttack(juce::jlimit(0.1f,50.0f,u.param("attack", 10.0f)));
        u.comp.setRelease(juce::jlimit(5.0f,400.0f,u.param("release", 120.0f)));
        l = u.comp.processSample(0, l); r = u.comp.processSample(0, r);
      } else if(type.contains("delay")){
        const float noteDiv = juce::jlimit(0.125f,2.0f,u.param("timeSync",0.5f));
        const float feedback = juce::jlimit(0.0f,0.95f,u.param("feedback",0.35f));
        const float wet = juce::jlimit(0.0f,1.0f,u.param("mix",0.3f));
        const float delaySamples = (float)((60.0/std::max(20.0,bpm)) * noteDiv * sampleRate);
        u.delayL.setDelay(delaySamples); u.delayR.setDelay(delaySamples);
        const float dl = u.delayL.popSample(0); const float dr = u.delayR.popSample(0);
        u.delayL.pushSample(0, l + dl*feedback); u.delayR.pushSample(0, r + dr*feedback);
        l = l*(1.0f-wet) + dl*wet; r = r*(1.0f-wet) + dr*wet;
      } else if(type.contains("chorus") || type.contains("flanger")){
        const float depthMs = juce::jlimit(0.1f,12.0f,u.param("depth",3.5f));
        const float rateHz = juce::jlimit(0.05f,8.0f,u.param("rate",0.35f));
        const float feedback = juce::jlimit(0.0f,0.9f,u.param("feedback",0.15f));
        const float wet = juce::jlimit(0.0f,1.0f,u.param("mix",0.35f));
        const float baseMs = type.contains("flanger") ? 2.5f : 12.0f;

        u.lfoPhase += (kTwoPi*rateHz)/std::max(1.0,sampleRate); if(u.lfoPhase>kTwoPi) u.lfoPhase-=kTwoPi;
        const float modMs = baseMs + depthMs * (0.5f*(1.0f + (float)std::sin(u.lfoPhase)));
        const float modSamp = modMs * (float)sampleRate * 0.001f;
        u.modL.setDelay(modSamp); u.modR.setDelay(modSamp);
        const float ml = u.modL.popSample(0); const float mr = u.modR.popSample(0);
        u.modL.pushSample(0, l + ml*feedback); u.modR.pushSample(0, r + mr*feedback);
        l = l*(1.0f-wet) + ml*wet; r = r*(1.0f-wet) + mr*wet;
      }
    }
  }

  void setupAudio(){ juce::AudioDeviceManager::AudioDeviceSetup s; s.sampleRate=sampleRate; s.bufferSize=bufferSize; s.inputChannels.clear(); s.outputChannels = juce::BigInteger().setRange(0,numOut,true); const auto err=deviceManager.initialise(numIn,numOut,nullptr,true,{},&s); if(err.isNotEmpty()){ ready=false; return; } deviceManager.addAudioCallback(this); ready = deviceManager.getCurrentAudioDevice()!=nullptr; }
  void shutdownAudio(){ deviceManager.removeAudioCallback(this); deviceManager.closeAudioDevice(); }
  double mtof(int n) const { return 440.0*std::pow(2.0,(n-69)/12.0); }
  juce::int64 ppqToSamples(double ppq) const { return (juce::int64)std::llround(((60.0/std::max(20.0,bpm))*ppq)*sampleRate); }
  double samplesToPpq(juce::int64 s) const { return ((double)s/std::max(1.0,sampleRate))/(60.0/std::max(20.0,bpm)); }

  InstrumentState defaultsForType(const juce::String& t) const {
    InstrumentState st; st.type=t; const auto x=t.toLowerCase();
    if(x=="bass"||x=="subbass"){ st.waveform=3; st.gain=0.95f; st.attack=0.002f; st.decay=0.09f; st.sustain=0.62f; st.release=0.16f; st.fm=0.01f; st.tone=1200.0f; }
    else if(x=="lead"){ st.waveform=2; st.gain=0.9f; st.attack=0.004f; st.decay=0.12f; st.sustain=0.55f; st.release=0.2f; st.fm=0.08f; st.tone=9000.0f; }
    else if(x=="pad"){ st.waveform=6; st.gain=0.72f; st.attack=0.035f; st.decay=0.3f; st.sustain=0.82f; st.release=0.52f; st.fm=0.015f; st.tone=6500.0f; }
    else if(x=="drums"||x=="touski"){ st.waveform=2; st.gain=0.95f; st.attack=0.0008f; st.decay=0.08f; st.sustain=0.02f; st.release=0.06f; st.drumMode=true; st.tone=9000.0f; }
    else if(x=="violin"){ st.waveform=5; st.gain=0.82f; st.attack=0.02f; st.decay=0.18f; st.sustain=0.78f; st.release=0.34f; st.fm=0.02f; st.tone=7200.0f; }
    else if(x=="piano"){ st.waveform=4; st.gain=0.9f; st.attack=0.003f; st.decay=0.16f; st.sustain=0.55f; st.release=0.24f; st.fm=0.035f; st.tone=5200.0f; }
    else { st.waveform=1; st.gain=0.85f; st.attack=0.005f; st.decay=0.14f; st.sustain=0.68f; st.release=0.24f; st.fm=0.03f; st.tone=7000.0f; }
    return st;
  }

  float waveSample(int waveform, double phase) const {
    switch(waveform){
      case 1:{ const double x=std::fmod(phase/kTwoPi,1.0); const double tri=4.0*std::abs(x-0.5)-1.0; return (float)(-tri); }
      case 2:{ const double x=std::fmod(phase/kTwoPi,1.0); return (float)(2.0*x-1.0); }
      case 3: return std::sin(phase)>=0?1.0f:-1.0f;
      case 4:{ const float s1=(float)std::sin(phase); const float s2=(float)std::sin(phase*2.0); const float s3=(float)std::sin(phase*3.0); return (s1*0.72f + s2*0.2f + s3*0.08f); }
      case 5:{ const double x=std::fmod(phase/kTwoPi,1.0); const float saw=(float)(2.0*x-1.0); const float tri=(float)(-(4.0*std::abs(x-0.5)-1.0)); return saw*0.65f + tri*0.35f; }
      case 6:{ const float s=(float)std::sin(phase); const double x=std::fmod(phase/kTwoPi,1.0); const float tri=(float)(-(4.0*std::abs(x-0.5)-1.0)); return s*0.55f + tri*0.45f; }
      default: return (float)std::sin(phase);
    }
  }

  void classifyDrum(Voice& x, int n){
    x.drumKind = 0; // kick
    if(n==38) x.drumKind = 1;
    else if(n==42) x.drumKind = 2;
    else if(n==46) x.drumKind = 3;
    else if(n==49) x.drumKind = 4;

    if(x.drumKind==0){ x.drumStartHz=150.0f; x.drumEndHz=50.0f; x.drumNoise=0.05f; x.attack=0.0005f; x.decay=0.09f; x.sustain=0.0f; x.release=0.08f; }
    else if(x.drumKind==1){ x.drumStartHz=260.0f; x.drumEndHz=170.0f; x.drumNoise=0.75f; x.attack=0.0003f; x.decay=0.08f; x.sustain=0.0f; x.release=0.07f; }
    else if(x.drumKind==2){ x.drumStartHz=8000.0f; x.drumEndHz=7000.0f; x.drumNoise=1.0f; x.attack=0.0001f; x.decay=0.02f; x.sustain=0.0f; x.release=0.015f; }
    else if(x.drumKind==3){ x.drumStartHz=8000.0f; x.drumEndHz=6500.0f; x.drumNoise=1.0f; x.attack=0.0001f; x.decay=0.03f; x.sustain=0.0f; x.release=0.06f; }
    else { x.drumStartHz=9000.0f; x.drumEndHz=6000.0f; x.drumNoise=1.0f; x.attack=0.0001f; x.decay=0.08f; x.sustain=0.0f; x.release=0.12f; }
  }

  void startVoice(const juce::String& instId, int mixCh, int n, float v){
    const auto iid = instId.isEmpty() ? juce::String("global") : instId;
    auto ii=instruments.find(iid); if(ii==instruments.end()){ instruments[iid]=defaultsForType("piano"); ii=instruments.find(iid);} const auto& st=ii->second;
    for(auto& x:voices) if(x.active&&x.note==n&&x.instId==iid){x.velocity=v; x.mixCh=mixCh; x.releasing=false; return;}
    if((int)voices.size()<kMaxSynthVoices) voices.push_back(Voice{});
    for(auto& x:voices) if(!x.active){
      x.note=n; x.instId=iid; x.mixCh=mixCh; x.velocity=v; x.phase=0; x.modPhase=0;
      x.phaseInc=kTwoPi*mtof(n)/std::max(1.0,sampleRate); x.modPhaseInc=x.phaseInc*2.0;
      x.fmAmount=st.fm; x.gain=st.gain; x.attack=st.attack; x.decay=st.decay; x.sustain=st.sustain; x.release=st.release; x.waveform=st.waveform;
      x.drum=st.drumMode;
      if(st.drumMode) classifyDrum(x, n);
      x.env=0.0f; x.ageSamples=0; x.releasing=false; x.active=true; return;
    }
  }

  void stopVoice(const juce::String& instId, int mixCh, int n){ const auto iid=instId.isEmpty()?juce::String("global"):instId; for(auto& x:voices) if(x.active&&x.note==n&&(x.instId==iid||iid=="global")&&(x.mixCh==mixCh||mixCh<=0)) x.releasing=true; }
  void panic(){ for(auto& x:voices) x.active=false; for(auto& x:sampleVoices) x.active=false; }

  void handleMixerSetOp(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    if(d && d->hasProperty("juceSpec")) lastMixerSpec = d->getProperty("juceSpec");
    if(d){
      if(op=="mixer.master.set") masterGain=(float)juce::jlimit(0.0,2.0,getDoubleProp(d,"gain",masterGain));
      else {
        const int ch=getIntProp(d,"ch",0);
        if(ch>=0){
          if((int)mixerStates.size()<=ch){ mixerStates.resize((size_t)(ch+1)); channelDsp.resize((size_t)(ch+1)); resizeMeters((int)mixerStates.size()); }
          auto& m=mixerStates[(size_t)ch];
          m.gain=(float)juce::jlimit(0.0,2.0,getDoubleProp(d,"gain",m.gain));
          m.pan=(float)juce::jlimit(-1.0,1.0,getDoubleProp(d,"pan",m.pan));
          m.eqLow=(float)juce::jlimit(-24.0,24.0,getDoubleProp(d,"eqLow", m.eqLow));
          m.eqMid=(float)juce::jlimit(-24.0,24.0,getDoubleProp(d,"eqMid", m.eqMid));
          m.eqHigh=(float)juce::jlimit(-24.0,24.0,getDoubleProp(d,"eqHigh", m.eqHigh));
          if(d->hasProperty("mute")) m.mute=(bool)d->getProperty("mute");
          if(d->hasProperty("solo")) m.solo=(bool)d->getProperty("solo");
          refreshEqForChannel(ch);
        }
      }
    }
    return resOk(op,id,juce::var());
  }

  std::vector<FxUnit>& resolveFxTarget(const juce::DynamicObject* d){
    if(!d || !d->hasProperty("target")) return masterFx;
    const auto target = d->getProperty("target");
    const auto* to = target.getDynamicObject();
    if(!to) return masterFx;
    const auto scope = getStringProp(to, "scope", "master");
    if(scope == "master") return masterFx;
    const int ch = getIntProp(to, "ch", 0);
    if(ch<0 || ch>=channelCount) return masterFx;
    return channelDsp[(size_t)ch].fx;
  }

  FxUnit* findFx(std::vector<FxUnit>& list, const juce::String& fxId){
    for(auto& f : list) if(f.id == fxId) return &f;
    return nullptr;
  }

  void handleFxSetOp(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    auto& list = resolveFxTarget(d);
    if(op=="fx.chain.set"){
      list.clear();
      if(d && d->hasProperty("chain") && d->getProperty("chain").isArray()){
        for(const auto& it : *d->getProperty("chain").getArray()){
          const auto* o = it.getDynamicObject(); if(!o) continue;
          FxUnit u; u.id = getStringProp(o, "id", "fx"); u.type = getStringProp(o, "type", ""); u.enabled = !o->hasProperty("enabled") || (bool)o->getProperty("enabled");
          list.push_back(std::move(u));
        }
      }
    } else if(op=="fx.param.set"){
      const auto fxId = d ? getStringProp(d,"id", op+"-"+id) : juce::String("fx");
      auto* fx = findFx(list, fxId);
      if(!fx){ FxUnit u; u.id = fxId; u.type = d ? getStringProp(d,"type","fx") : juce::String("fx"); list.push_back(std::move(u)); fx=&list.back(); }
      if(d && d->hasProperty("params")){
        const auto params = d->getProperty("params");
        if(auto* po = params.getDynamicObject()) fx->params = po->getProperties();
      }
      if(d && d->hasProperty("juceSpec")) fxSpecCache[fxId]=d->getProperty("juceSpec");
    } else if(op=="fx.bypass.set"){
      const auto fxId = d ? getStringProp(d,"id", op+"-"+id) : juce::String("fx");
      if(auto* fx = findFx(list, fxId)) fx->bypass = d && (bool)d->getProperty("bypass");
    }
    return resOk(op,id,juce::var());
  }

  void handleInstCreate(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    if(!d) return resErr(op,id,"E_BAD_ENVELOPE","Missing inst.create data");
    const auto instId=getStringProp(d,"instId","");
    if(instId.isEmpty()) return resErr(op,id,"E_BAD_REQUEST","instId required");
    instruments[instId]=defaultsForType(getStringProp(d,"type","piano"));
    return resOk(op,id,juce::var());
  }

  void handleInstParamSet(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    if(!d) return resErr(op,id,"E_BAD_ENVELOPE","Missing inst.param.set data");
    const auto instId=getStringProp(d,"instId","");
    if(instId.isEmpty()) return resErr(op,id,"E_BAD_REQUEST","instId required");
    auto it=instruments.find(instId);
    if(it==instruments.end()) it=instruments.emplace(instId, defaultsForType(getStringProp(d,"type","piano"))).first;
    auto& st=it->second;
    const auto pv=d->getProperty("params");
    if(d->hasProperty("juceSpec")) st.juceSpec=d->getProperty("juceSpec");
    const auto* pObj=pv.getDynamicObject();
    if(pObj){
      st.gain=(float)std::max(0.0,getDoubleProp(pObj,"gain",st.gain));
      st.attack=(float)std::max(0.001,getDoubleProp(pObj,"attack",st.attack));
      st.decay=(float)std::max(0.005,getDoubleProp(pObj,"decay",st.decay));
      st.sustain=(float)juce::jlimit(0.0,1.0,getDoubleProp(pObj,"sustain",st.sustain));
      st.release=(float)std::max(0.01,getDoubleProp(pObj,"release",st.release));
      st.fm=(float)juce::jlimit(0.0,1.0,getDoubleProp(pObj,"fm",st.fm)*0.01);
      st.tone=(float)std::max(200.0,getDoubleProp(pObj,"tone",st.tone));
    }
    return resOk(op,id,juce::var());
  }

  std::shared_ptr<SampleData> loadSampleFromPath(const juce::String& p){
    juce::File f(p);
    if(p.isEmpty() || !f.existsAsFile()) return {};
    auto r=std::unique_ptr<juce::AudioFormatReader>(formatManager.createReaderFor(f));
    if(!r) return {};
    auto sd=std::make_shared<SampleData>();
    sd->sampleRate=r->sampleRate; sd->buffer.setSize((int)r->numChannels,(int)r->lengthInSamples);
    r->read(&sd->buffer,0,(int)r->lengthInSamples,0,true,true);
    return sd;
  }

  void handleSamplerLoad(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    if(!d) return resErr(op,id,"E_BAD_ENVELOPE","Missing sampler.load data");
    const auto sid=getStringProp(d,"sampleId","");
    const auto p=getStringProp(d,"path","");
    auto sd = loadSampleFromPath(p);
    if(sid.isEmpty() || !sd) return resErr(op,id,"E_LOAD_FAIL","Invalid sample");
    sampleCache[sid]=sd; return resOk(op,id,juce::var());
  }

  void handleSamplerTrigger(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    if(!d) return resErr(op,id,"E_BAD_ENVELOPE","Missing sampler.trigger data");
    auto it=sampleCache.find(getStringProp(d,"sampleId","")); if(it==sampleCache.end()) return resErr(op,id,"E_NOT_LOADED","sampleId not loaded");

    if(!d)
      return resErr(op,id,"E_BAD_ENVELOPE","Missing sampler.trigger data");

    auto it=sampleCache.find(getStringProp(d,"sampleId",""));
    if(it==sampleCache.end())
      return resErr(op,id,"E_NOT_LOADED","sampleId not loaded");
    const auto sd=it->second;
    const int total=sd->buffer.getNumSamples();
    int st=juce::jlimit(0,std::max(0,total-2),(int)std::floor(getDoubleProp(d,"startNorm",0.0)*total));
    int en=juce::jlimit(st+1,total,(int)std::ceil(getDoubleProp(d,"endNorm",1.0)*total));
    if(en<=st) en=juce::jlimit(st+1,total,st+1);

    const auto mode=getStringProp(d,"mode","vinyl");
    int note=getIntProp(d,"note",60);
    const int root=getIntProp(d,"rootMidi",60);
    if(mode=="fixed") note=root;

    const double sem=(double)(note-root);
    double rate=std::pow(2.0,sem/12.0);
    if(mode=="fit_duration_vinyl"){
      double durationSec=getDoubleProp(d,"durationSec",0.0);
      if(durationSec<=0.0){
        const double patternSteps=getDoubleProp(d,"patternSteps",0.0);
        const double patternBeats=patternSteps>0.0 ? (patternSteps/4.0) : getDoubleProp(d,"patternBeats",0.0);
        const double reqBpm=std::max(20.0, getDoubleProp(d,"bpm", bpm));
        if(patternBeats>0.0) durationSec=(60.0/reqBpm)*patternBeats;
      }
      if(durationSec>0.0){
        const double sliceSec=(en-st)/std::max(1.0,sd->sampleRate);
        rate = sliceSec/durationSec;
      }
    }

    const float vel=(float)juce::jlimit(0.0,1.0,getDoubleProp(d,"velocity",0.85));
    const float gain=(float)std::max(0.0,getDoubleProp(d,"gain",1.0));
    const int mixCh=juce::jmax(1,getIntProp(d,"mixCh",1));
    SampleVoice sv; sv.sample=sd; sv.start=st; sv.end=en; sv.pos=(double)st; sv.rate=rate; sv.gainL=gain*vel; sv.gainR=gain*vel; sv.mixCh=mixCh; sv.active=true;
        if(patternBeats>0.0)
          durationSec=(60.0/reqBpm)*patternBeats;
      }
      if(durationSec>0.0){
        const double slice=(en-st)/std::max(1.0,sd->sampleRate);
        rate = slice/durationSec;
      }
    }
    const float vel=(float)juce::jlimit(0.0,1.0,getDoubleProp(d,"velocity",0.85)); const float gain=(float)std::max(0.0,getDoubleProp(d,"gain",1.0)); const float pan=(float)juce::jlimit(-1.0,1.0,getDoubleProp(d,"pan",0.0));
    SampleVoice sv; sv.sample=sd; sv.start=st; sv.end=en; sv.pos=(double)st; sv.rate=rate; sv.gainL=gain*vel; sv.gainR=gain*vel; sv.mixCh=juce::jmax(1,getIntProp(d,"mixCh",1)); sv.fadeIn=(int)std::max(1.0,0.003*sampleRate); sv.fadeOut=sv.fadeIn; sv.active=true;
    bool placed=false; for(auto& v:sampleVoices){ if(!v.active){v=sv; placed=true; break; }} if(!placed && (int)sampleVoices.size()<kMaxSampleVoices) sampleVoices.push_back(sv); return resOk(op,id,juce::var());
  }

  void handleTouskiProgramLoad(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    if(!d) return resErr(op,id,"E_BAD_REQUEST","Missing touski.program.load data");
    const auto instId = getStringProp(d, "instId", "touski");
    std::unordered_map<int, std::shared_ptr<SampleData>> mapping;

    if(d->hasProperty("samples") && d->getProperty("samples").isArray()){
      for(const auto& it : *d->getProperty("samples").getArray()){
        const auto* o = it.getDynamicObject(); if(!o) continue;
        const int note = getIntProp(o, "note", 60);
        const auto path = getStringProp(o, "path", "");
        auto sd = loadSampleFromPath(path);
        if(sd) mapping[note]=sd;
      }
    }

    if(mapping.empty()){
      const auto programPath = getStringProp(d, "programPath", "");
      juce::File f(programPath);
      if(f.existsAsFile()){
        const auto txt = f.loadFileAsString();
        auto v = juce::JSON::parse(txt);
        if(auto* root = v.getDynamicObject()){
          const auto zones = root->getProperty("zones");
          if(zones.isArray()){
            for(const auto& z : *zones.getArray()){
              const auto* zo = z.getDynamicObject(); if(!zo) continue;
              int note = getIntProp(zo, "note", getIntProp(zo, "rootMidi", 60));
              auto path = getStringProp(zo, "path", getStringProp(zo, "samplePath", ""));
              auto sd = loadSampleFromPath(path);
              if(sd) mapping[note]=sd;
            }
          }
          if(mapping.empty() && root->hasProperty("sample")){
            auto sampleVar = root->getProperty("sample");
            if(auto* so = sampleVar.getDynamicObject()){
              auto path = getStringProp(so, "path", "");
              auto sd = loadSampleFromPath(path);
              if(sd) mapping[60] = sd;
            }
          }
        }
      }
    }

    if(mapping.empty()) return resErr(op,id,"E_LOAD_FAIL","No samples in touski program");
    touskiNoteSamples[instId] = std::move(mapping);
    return resOk(op,id,juce::var());
  }

  void handleTouskiNoteOn(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    if(!d) return resErr(op,id,"E_BAD_REQUEST","Missing touski.note.on data");
    const auto instId = getStringProp(d, "instId", "touski");
    const int note = getIntProp(d, "note", 60);
    const float vel = (float)juce::jlimit(0.0,1.0,getDoubleProp(d,"vel",0.85));
    const int mixCh = juce::jmax(1,getIntProp(d,"mixCh",1));

    auto it = touskiNoteSamples.find(instId);
    if(it==touskiNoteSamples.end()) return resErr(op,id,"E_NOT_LOADED","Touski program not loaded");
    auto mit = it->second.find(note);
    if(mit==it->second.end()) mit = it->second.find(60);
    if(mit==it->second.end()) return resErr(op,id,"E_NOT_FOUND","No sample for note");

    const auto sd = mit->second;
    SampleVoice sv; sv.sample=sd; sv.start=0; sv.end=sd->buffer.getNumSamples(); sv.pos=0.0; sv.rate=1.0; sv.gainL=vel; sv.gainR=vel; sv.mixCh=mixCh; sv.active=true;
    bool placed=false; for(auto& v:sampleVoices){ if(!v.active){ v=sv; placed=true; break; } }
    if(!placed && (int)sampleVoices.size()<kMaxSampleVoices) sampleVoices.push_back(sv);
    return resOk(op,id,juce::var());
  }

  juce::var helloData(){ juce::DynamicObject::Ptr caps=new juce::DynamicObject(); caps->setProperty("webaudioFallback", false); caps->setProperty("projectSync", true); juce::DynamicObject::Ptr d=new juce::DynamicObject(); d->setProperty("protocol","SLS-IPC/1.0"); d->setProperty("engineName","sls-audio-engine"); d->setProperty("engineVersion","0.2.0"); d->setProperty("platform", juce::SystemStats::getOperatingSystemName()); d->setProperty("pid", SLS_GET_PID()); d->setProperty("capabilities", juce::var(caps.get())); return juce::var(d.get()); }
  juce::var engineState(){ juce::DynamicObject::Ptr d=new juce::DynamicObject(); d->setProperty("ready",ready); d->setProperty("sampleRate",sampleRate); d->setProperty("bufferSize",bufferSize); d->setProperty("cpuLoad",0.0); d->setProperty("xruns",0); return juce::var(d.get()); }
  juce::var engineConfig(){ juce::DynamicObject::Ptr d=new juce::DynamicObject(); d->setProperty("sampleRate",sampleRate); d->setProperty("bufferSize",bufferSize); d->setProperty("numOut",numOut); d->setProperty("numIn",numIn); return juce::var(d.get()); }
  juce::var transportState(){ juce::DynamicObject::Ptr d=new juce::DynamicObject(); d->setProperty("playing",playing); d->setProperty("bpm",bpm); d->setProperty("ppq",samplesToPpq(samplePos)); d->setProperty("samplePos",(int)samplePos); return juce::var(d.get()); }
  juce::var meterData(){
    juce::Array<juce::var> frames;
    auto add=[&](int ch,float rL,float rR,float pL,float pR){ juce::DynamicObject::Ptr f=new juce::DynamicObject(); juce::Array<juce::var> rms{rL,rR}; juce::Array<juce::var> peak{pL,pR}; f->setProperty("ch",ch); f->setProperty("rms",juce::var(rms)); f->setProperty("peak",juce::var(peak)); frames.add(juce::var(f.get()));};
    if(meterChannels.count(-1)) add(-1,meterRmsL,meterRmsR,meterPeakL,meterPeakR);
    for(int ch=0; ch<channelCount; ++ch){
      if(!meterChannels.count(ch)) continue;
      const size_t i=(size_t)juce::jmax(0,ch);
      const float rL=i<meterChRmsL.size()?meterChRmsL[i]:0.0f;
      const float rR=i<meterChRmsR.size()?meterChRmsR[i]:0.0f;
      const float pL=i<meterChPeakL.size()?meterChPeakL[i]:0.0f;
      const float pR=i<meterChPeakR.size()?meterChPeakR[i]:0.0f;
      add(ch,rL,rR,pL,pR);
      if(i<meterChPeakL.size()){ meterChPeakL[i]=0.0f; meterChPeakR[i]=0.0f; }
    }
    juce::DynamicObject::Ptr d=new juce::DynamicObject();
    d->setProperty("frames",juce::var(frames));
    meterPeakL=0; meterPeakR=0;
    return juce::var(d.get());
  }

  void write(const juce::var& v){ std::cout << juce::JSON::toString(v,true).toStdString() << "\n"; std::cout.flush(); }
  void resOk(const juce::String& op,const juce::String& id,const juce::var& data){ juce::DynamicObject::Ptr o=new juce::DynamicObject(); o->setProperty("v",1); o->setProperty("type","res"); o->setProperty("op",op); o->setProperty("id",id); o->setProperty("ts",nowMs()); o->setProperty("ok",true); o->setProperty("data",data); write(juce::var(o.get())); }
  void resErr(const juce::String& op,const juce::String& id,const juce::String& code,const juce::String& msg){ juce::DynamicObject::Ptr e=new juce::DynamicObject(); e->setProperty("code",code); e->setProperty("message",msg); juce::DynamicObject::Ptr o=new juce::DynamicObject(); o->setProperty("v",1); o->setProperty("type","res"); o->setProperty("op",op); o->setProperty("id",id); o->setProperty("ts",nowMs()); o->setProperty("ok",false); o->setProperty("err",juce::var(e.get())); write(juce::var(o.get())); }
  void emitEvt(const juce::String& op,const juce::var& data){ juce::DynamicObject::Ptr o=new juce::DynamicObject(); o->setProperty("v",1); o->setProperty("type","evt"); o->setProperty("op",op); o->setProperty("id","evt-"+juce::String(nowMs())); o->setProperty("ts",nowMs()); o->setProperty("data",data); write(juce::var(o.get())); }

  void pumpEvents(){
    while(running){ std::this_thread::sleep_for(std::chrono::milliseconds(1000)); emitEvt("engine.state", engineState()); emitEvt("transport.state", transportState()); if(meterSubscribed){ const int ms = (int)std::max(1,1000/std::max(1,meterFps)); for(int i=0;i<std::max(1,meterFps);++i){ emitEvt("meter.level", meterData()); std::this_thread::sleep_for(std::chrono::milliseconds(ms)); if(!running||!meterSubscribed) break; } } }
  }
};
}

int main(){
  Engine engine;
  std::string line;
  while(engine.isRunning() && std::getline(std::cin,line)){
    if(line.empty()) continue;
    juce::var msg;
    if(juce::JSON::parse(line,msg).wasOk()) engine.handle(msg);
  }
  return 0;
}
