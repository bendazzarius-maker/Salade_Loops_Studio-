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
constexpr int kMaxSampleVoices = 64;
juce::int64 nowMs() { return juce::Time::currentTimeMillis(); }

struct Voice { int note = 60; float velocity = 0.8f; double phase = 0.0; double phaseInc = 0.0; double modPhase = 0.0; double modPhaseInc = 0.0; float fmAmount = 0.0f; float gain = 1.0f; float attack = 0.003f; float decay = 0.12f; float sustain = 0.7f; float release = 0.2f; float env = 0.0f; int ageSamples = 0; bool releasing = false; juce::String instId = "global"; int waveform = 0; bool active = false; };
struct SampleData { double sampleRate = 48000.0; juce::AudioBuffer<float> buffer; };
struct SampleVoice {
  std::shared_ptr<const SampleData> sample; int start = 0; int end = 0; double pos = 0.0; double rate = 1.0;
  float gainL = 1.0f; float gainR = 1.0f; int fadeIn = 0; int fadeOut = 0; bool active = false;
};

struct InstrumentState {
  juce::String type = "piano";
  float gain = 1.0f;
  float attack = 0.003f;
  float decay = 0.12f;
  float sustain = 0.7f;
  float release = 0.2f;
  float fm = 0.0f;
  float tone = 12000.0f;
  int waveform = 0; // 0=sine,1=triangle,2=saw,3=square
  bool drumMode = false;
  juce::var juceSpec;
};

struct MixerChannelState {
  float gain = 0.85f;
  float pan = 0.0f;
  bool mute = false;
  bool solo = false;
};

static double getDoubleProp(const juce::DynamicObject* o, const char* key, double def){ if(!o) return def; const auto v=o->getProperty(key); return (v.isInt()||v.isDouble())?(double)v:def; }
static int getIntProp(const juce::DynamicObject* o, const char* key, int def){ return (int) std::llround(getDoubleProp(o,key,def)); }
static juce::String getStringProp(const juce::DynamicObject* o, const char* key, const juce::String& def={}){ if(!o) return def; const auto v=o->getProperty(key); return v.isString()?v.toString():def; }

class Engine : public juce::AudioIODeviceCallback {
public:
  Engine(){ formatManager.registerBasicFormats(); setupAudio(); emitEvt("engine.state", engineState()); emitEvt("transport.state", transportState()); stateThread = std::thread([this]{pumpEvents();}); }
  ~Engine() override { running=false; if(stateThread.joinable()) stateThread.join(); shutdownAudio(); }
  bool isRunning() const { return running.load(); }

  void handleMixerSetOp(const juce::String& op,const juce::String& id,const juce::DynamicObject* d);
  void handleFxSetOp(const juce::String& op,const juce::String& id,const juce::DynamicObject* d);

  void handle(const juce::var& msg){
    auto* obj = msg.getDynamicObject(); if(!obj || obj->getProperty("type").toString() != "req") return;
    const auto op = obj->getProperty("op").toString(); const auto id = obj->getProperty("id").toString(); const auto data = obj->getProperty("data"); const auto* d = data.getDynamicObject();

    if(op=="engine.hello") return resOk(op,id,helloData());
    if(op=="engine.ping") return resOk(op,id,data);
    if(op=="engine.state.get"||op=="engine.getState") return resOk(op,id,engineState());
    if(op=="engine.config.get") return resOk(op,id,engineConfig());
    if(op=="engine.config.set"||op=="engine.setConfig"){
      sampleRate = std::max(22050.0, getDoubleProp(d,"sampleRate",sampleRate)); bufferSize = std::max(64,getIntProp(d,"bufferSize",bufferSize));
      numOut=std::max(1,getIntProp(d,"numOut",numOut)); numIn=std::max(0,getIntProp(d,"numIn",numIn)); shutdownAudio(); setupAudio();
      resOk(op,id,engineConfig()); emitEvt("engine.state", engineState()); return;
    }
    if(op=="engine.shutdown"){ running=false; return resOk(op,id,juce::var()); }

    // Accept project snapshots from UI so transport.play is not blocked by E_UNKNOWN_OP
    if(op=="project.sync") return resOk(op,id,juce::var());

    if(op=="mixer.init"){ channelCount = juce::jlimit(1,64,getIntProp(d,"channels",16)); mixerStates.resize((size_t)channelCount); return resOk(op,id,juce::var()); }
    if(op=="mixer.master.set"||op=="mixer.channel.set") return handleMixerSetOp(op,id,d);
    if(op=="fx.chain.set"||op=="fx.param.set"||op=="fx.bypass.set") return handleFxSetOp(op,id,d);
    if(op=="mixer.route.set") return resOk(op,id,juce::var());

    if(op=="inst.create") return handleInstCreate(op,id,d);
    if(op=="inst.param.set") return handleInstParamSet(op,id,d);
    if(op=="inst.delete"){ if(d) instruments.erase(getStringProp(d,"instId","")); return resOk(op,id,juce::var()); }
    if(op=="touski.program.load"||op=="touski.sample.preload"||op=="touski.param.set") return resOk(op,id,juce::var());

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

    if(op=="note.on"||op=="midi.noteOn"||op=="touski.note.on"){ startVoice(getStringProp(d,"instId","global"), getIntProp(d,"note",60),(float)getDoubleProp(d,"vel",getDoubleProp(d,"velocity",0.8))); return resOk(op,id,juce::var()); }
    if(op=="note.off"||op=="midi.noteOff"||op=="touski.note.off"){ stopVoice(getStringProp(d,"instId","global"), getIntProp(d,"note",60)); return resOk(op,id,juce::var()); }
    if(op=="note.allOff"||op=="midi.panic"){ panic(); return resOk(op,id,juce::var()); }

    return resErr(op,id,"E_UNKNOWN_OP","Unknown opcode");
  }

  void audioDeviceIOCallbackWithContext(const float* const*, int, float* const* out, int chs, int n, const juce::AudioIODeviceCallbackContext&) override {
    juce::ScopedLock sl(audioLock);
    for(int ch=0; ch<chs; ++ch) if(out[ch]) juce::FloatVectorOperations::clear(out[ch], n);

    bool hasActiveVoices = false;
    for(const auto& v : voices){ if(v.active){ hasActiveVoices = true; break; } }
    if(!hasActiveVoices){
      for(const auto& sv : sampleVoices){ if(sv.active){ hasActiveVoices = true; break; } }
    }
    if(!playing && !hasActiveVoices) return;

    for(int i=0;i<n;++i){
      float L=0.0f,R=0.0f;
      for(auto& sv: sampleVoices){ if(!sv.active||!sv.sample) continue; const auto& b=sv.sample->buffer; const int ip=(int)sv.pos; if(ip>=sv.end||ip>=b.getNumSamples()-1){sv.active=false; continue;} const float frac=(float)(sv.pos-ip); const float l=b.getSample(0,ip)+(b.getSample(0,ip+1)-b.getSample(0,ip))*frac; float r=l; if(b.getNumChannels()>1) r=b.getSample(1,ip)+(b.getSample(1,ip+1)-b.getSample(1,ip))*frac; L+=l*sv.gainL; R+=r*sv.gainR; sv.pos+=sv.rate; }
      bool anySolo=false; for(const auto& mc:mixerStates) if(mc.solo){ anySolo=true; break; }
      for(auto& v:voices){ if(!v.active) continue; const int atkS=std::max(1,(int)std::llround(v.attack*sampleRate)); const int decS=std::max(1,(int)std::llround(v.decay*sampleRate)); const int relS=std::max(1,(int)std::llround(v.release*sampleRate)); if(!v.releasing){ if(v.ageSamples<atkS) v.env=(float)v.ageSamples/(float)atkS; else if(v.ageSamples<atkS+decS){ const float t=(float)(v.ageSamples-atkS)/(float)decS; v.env=1.0f-(1.0f-v.sustain)*t; } else v.env=v.sustain; } else { const float mul=std::exp(std::log(0.0001f)/(float)relS); v.env*=mul; if(v.env<0.0002f){ v.active=false; continue; } } const float mod=(float)std::sin(v.modPhase)*v.fmAmount; float sig=0.0f; if(v.drum){ const float prog=(float)juce::jlimit(0.0,1.0,v.ageSamples/(sampleRate*0.12)); const float curHz=v.drumStartHz + (v.drumEndHz-v.drumStartHz)*prog; const double inc=kTwoPi*curHz/std::max(1.0,sampleRate); v.phase += inc; if(v.phase>kTwoPi) v.phase-=kTwoPi; const float tonal=std::sin(v.phase); const float noise=((float)rng.nextDouble()*2.0f-1.0f); sig=(tonal*(1.0f-v.drumNoise)+noise*v.drumNoise); } else { sig=waveSample(v.waveform, v.phase+mod); v.phase += v.phaseInc; v.modPhase += v.modPhaseInc; if(v.phase>kTwoPi) v.phase-=kTwoPi; if(v.modPhase>kTwoPi) v.modPhase-=kTwoPi; }
        int idx=juce::jmax(0,v.mixCh-1); if(idx>=(int)mixerStates.size()) idx=0; const auto& mc=mixerStates[(size_t)idx]; if(mc.mute || (anySolo && !mc.solo)){ ++v.ageSamples; continue; }
        const float amp=sig*v.velocity*v.gain*v.env*0.2f*mc.gain*masterGain; const float pan=juce::jlimit(-1.0f,1.0f,mc.pan); L += amp*0.5f*(1.0f-pan); R += amp*0.5f*(1.0f+pan); ++v.ageSamples; }
      if(chs>0&&out[0]) out[0][i]=L; if(chs>1&&out[1]) out[1][i]=R;
      meterPeakL = std::max(meterPeakL, std::abs(L)); meterPeakR = std::max(meterPeakR, std::abs(R)); meterRmsAccL += L*L; meterRmsAccR += R*R;
    }
    samplePos += n;
    if(loopEnabled && loopPpqEnd>loopPpqStart){ const auto le=ppqToSamples(loopPpqEnd); if(samplePos>=le) samplePos=ppqToSamples(loopPpqStart); }
    meterRmsL = (float) std::sqrt(meterRmsAccL / std::max(1,n)); meterRmsR = (float) std::sqrt(meterRmsAccR / std::max(1,n)); meterRmsAccL=0; meterRmsAccR=0;
  }
  void audioDeviceAboutToStart(juce::AudioIODevice* d) override { if(d){ sampleRate=d->getCurrentSampleRate(); bufferSize=d->getCurrentBufferSizeSamples(); ready=true; } }
  void audioDeviceStopped() override {}

private:
  juce::AudioDeviceManager deviceManager; juce::AudioFormatManager formatManager; juce::CriticalSection audioLock;
  std::vector<Voice> voices; std::vector<SampleVoice> sampleVoices; std::unordered_map<juce::String,std::shared_ptr<SampleData>> sampleCache; std::unordered_map<juce::String,InstrumentState> instruments;
  std::atomic<bool> running{true}; std::thread stateThread;
  bool ready=false, playing=false, loopEnabled=false; double bpm=120.0, sampleRate=48000.0, loopPpqStart=0.0, loopPpqEnd=16.0; int bufferSize=512, numOut=2, numIn=0, channelCount=16; float masterGain=0.85f; std::vector<MixerChannelState> mixerStates=std::vector<MixerChannelState>(16);
  juce::int64 samplePos=0; bool meterSubscribed=false; int meterFps=30; std::unordered_set<int> meterChannels;
  float meterPeakL=0,meterPeakR=0,meterRmsL=0,meterRmsR=0; double meterRmsAccL=0,meterRmsAccR=0;

  void handleMixerSetOp(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    if(d && d->hasProperty("juceSpec"))
      lastMixerSpec = d->getProperty("juceSpec");
    if(d){
      if(op=="mixer.master.set"){
        masterGain=(float)juce::jlimit(0.0,2.0,getDoubleProp(d,"gain",masterGain));
      } else {
        const int ch=getIntProp(d,"ch",0);
        if(ch>=0){
          if((int)mixerStates.size()<=ch) mixerStates.resize((size_t)(ch+1));
          auto& m=mixerStates[(size_t)ch];
          m.gain=(float)juce::jlimit(0.0,2.0,getDoubleProp(d,"gain",m.gain));
          m.pan=(float)juce::jlimit(-1.0,1.0,getDoubleProp(d,"pan",m.pan));
          if(d->hasProperty("mute")) m.mute=(bool)d->getProperty("mute");
          if(d->hasProperty("solo")) m.solo=(bool)d->getProperty("solo");
        }
      }
    }
    return resOk(op,id,juce::var());
  }

  void handleFxSetOp(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    if(d){
      const auto fxId=getStringProp(d,"id", op+"-"+id);
      if(d->hasProperty("juceSpec"))
        fxSpecCache[fxId]=d->getProperty("juceSpec");
    }
    return resOk(op,id,juce::var());
  }

  void setupAudio(){ juce::AudioDeviceManager::AudioDeviceSetup s; s.sampleRate=sampleRate; s.bufferSize=bufferSize; s.inputChannels.clear(); s.outputChannels = juce::BigInteger().setRange(0,numOut,true); const auto err=deviceManager.initialise(numIn,numOut,nullptr,true,{},&s); if(err.isNotEmpty()){ ready=false; return; } deviceManager.addAudioCallback(this); ready = deviceManager.getCurrentAudioDevice()!=nullptr; }
  void shutdownAudio(){ deviceManager.removeAudioCallback(this); deviceManager.closeAudioDevice(); }
  double mtof(int n) const { return 440.0*std::pow(2.0,(n-69)/12.0); }
  juce::int64 ppqToSamples(double ppq) const { return (juce::int64)std::llround(((60.0/std::max(20.0,bpm))*ppq)*sampleRate); }
  double samplesToPpq(juce::int64 s) const { return ((double)s/std::max(1.0,sampleRate))/(60.0/std::max(20.0,bpm)); }
  InstrumentState defaultsForType(const juce::String& t) const { InstrumentState st; st.type=t; const auto x=t.toLowerCase(); if(x=="bass"||x=="subbass"){ st.waveform=3; st.gain=0.95f; st.attack=0.002f; st.decay=0.09f; st.sustain=0.6f; st.release=0.18f; } else if(x=="lead"){ st.waveform=2; st.gain=0.9f; st.attack=0.004f; st.decay=0.12f; st.sustain=0.55f; st.release=0.2f; st.fm=0.06f; } else if(x=="pad"){ st.waveform=1; st.gain=0.75f; st.attack=0.03f; st.decay=0.25f; st.sustain=0.8f; st.release=0.45f; } else if(x=="drums"||x=="touski"){ st.waveform=2; st.gain=0.8f; st.attack=0.001f; st.decay=0.05f; st.sustain=0.15f; st.release=0.06f; } else if(x=="violin"){ st.waveform=1; st.gain=0.85f; st.attack=0.02f; st.decay=0.15f; st.sustain=0.75f; st.release=0.3f; } else { st.waveform=1; st.gain=0.9f; st.attack=0.003f; st.decay=0.12f; st.sustain=0.65f; st.release=0.22f; st.fm=0.03f; } return st; }
  float waveSample(int waveform, double phase) const { switch(waveform){ case 1:{ const double x=std::fmod(phase/kTwoPi,1.0); const double tri=4.0*std::abs(x-0.5)-1.0; return (float)(-tri);} case 2:{ const double x=std::fmod(phase/kTwoPi,1.0); return (float)(2.0*x-1.0);} case 3: return std::sin(phase)>=0?1.0f:-1.0f; default: return std::sin(phase);} }
  void startVoice(const juce::String& instId, int n, float v){
    const auto iid = instId.isEmpty() ? juce::String("global") : instId;
    auto ii=instruments.find(iid); if(ii==instruments.end()){ instruments[iid]=defaultsForType("piano"); ii=instruments.find(iid);} const auto& st=ii->second;
    for(auto& x:voices) if(x.active&&x.note==n&&x.instId==iid){x.velocity=v; x.releasing=false; return;}
    if((int)voices.size()<kMaxSynthVoices) voices.push_back(Voice{});
    for(auto& x:voices) if(!x.active){ x.note=n; x.instId=iid; x.velocity=v; x.phase=0; x.modPhase=0; x.phaseInc=kTwoPi*mtof(n)/std::max(1.0,sampleRate); x.modPhaseInc=x.phaseInc*2.0; x.fmAmount=st.fm; x.gain=st.gain; x.attack=st.attack; x.decay=st.decay; x.sustain=st.sustain; x.release=st.release; x.waveform=st.waveform; x.env=0.0f; x.ageSamples=0; x.releasing=false; x.active=true; return; }
  }
  void stopVoice(const juce::String& instId, int n){ const auto iid=instId.isEmpty()?juce::String("global"):instId; for(auto& x:voices) if(x.active&&x.note==n&&(x.instId==iid||iid=="global")) x.releasing=true; }
  void panic(){ for(auto& x:voices) x.active=false; for(auto& x:sampleVoices) x.active=false; }

  void handleInstCreate(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    if(!d)
      return resErr(op,id,"E_BAD_ENVELOPE","Missing inst.create data");
    const auto instId=getStringProp(d,"instId","");
    if(instId.isEmpty())
      return resErr(op,id,"E_BAD_REQUEST","instId required");
    instruments[instId]=defaultsForType(getStringProp(d,"type","piano"));
    return resOk(op,id,juce::var());
  }
  void handleInstParamSet(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    if(!d)
      return resErr(op,id,"E_BAD_ENVELOPE","Missing inst.param.set data");
    const auto instId=getStringProp(d,"instId","");
    if(instId.isEmpty())
      return resErr(op,id,"E_BAD_REQUEST","instId required");
    auto it=instruments.find(instId);
    if(it==instruments.end())
      it=instruments.emplace(instId, defaultsForType(getStringProp(d,"type","piano"))).first;
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

  void handleSamplerLoad(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    if(!d)
      return resErr(op,id,"E_BAD_ENVELOPE","Missing sampler.load data");

    const auto sid=getStringProp(d,"sampleId","");
    const auto p=getStringProp(d,"path","");
    juce::File f(p); if(sid.isEmpty()||!f.existsAsFile()) return resErr(op,id,"E_LOAD_FAIL","Invalid sample"); auto r=std::unique_ptr<juce::AudioFormatReader>(formatManager.createReaderFor(f)); if(!r) return resErr(op,id,"E_LOAD_FAIL","Unsupported format");
    auto sd=std::make_shared<SampleData>(); sd->sampleRate=r->sampleRate; sd->buffer.setSize((int)r->numChannels,(int)r->lengthInSamples); r->read(&sd->buffer,0,(int)r->lengthInSamples,0,true,true); sampleCache[sid]=sd; return resOk(op,id,juce::var());
  }
  void handleSamplerTrigger(const juce::String& op,const juce::String& id,const juce::DynamicObject* d){
    if(!d)
      return resErr(op,id,"E_BAD_ENVELOPE","Missing sampler.trigger data");

    auto it=sampleCache.find(getStringProp(d,"sampleId",""));
    if(it==sampleCache.end())
      return resErr(op,id,"E_NOT_LOADED","sampleId not loaded");
    const auto sd=it->second; const int total=sd->buffer.getNumSamples(); int st=juce::jlimit(0,std::max(0,total-2),(int)std::floor(getDoubleProp(d,"startNorm",0.0)*total)); int en=juce::jlimit(st+1,total,(int)std::ceil(getDoubleProp(d,"endNorm",1.0)*total));
    const int note=getIntProp(d,"note",60), root=getIntProp(d,"rootMidi",60); const double sem=(double)(note-root); double rate=std::pow(2.0,sem/12.0);
    if(getStringProp(d,"mode","")=="fit_duration_vinyl"){ const double durationSec=getDoubleProp(d,"durationSec",0.0); if(durationSec>0){ const double slice=(en-st)/std::max(1.0,sd->sampleRate); rate = slice/durationSec; }}
    const float vel=(float)juce::jlimit(0.0,1.0,getDoubleProp(d,"velocity",0.85)); const float gain=(float)std::max(0.0,getDoubleProp(d,"gain",1.0)); const float pan=(float)juce::jlimit(-1.0,1.0,getDoubleProp(d,"pan",0.0));
    SampleVoice sv; sv.sample=sd; sv.start=st; sv.end=en; sv.pos=(double)st; sv.rate=rate; sv.gainL=gain*vel*0.5f*(1.0f-pan); sv.gainR=gain*vel*0.5f*(1.0f+pan); sv.fadeIn=(int)std::max(1.0,0.003*sampleRate); sv.fadeOut=sv.fadeIn; sv.active=true;
    bool placed=false; for(auto& v:sampleVoices){ if(!v.active){v=sv; placed=true; break; }} if(!placed && (int)sampleVoices.size()<kMaxSampleVoices) sampleVoices.push_back(sv); return resOk(op,id,juce::var());
  }

  juce::var helloData(){ juce::DynamicObject::Ptr caps=new juce::DynamicObject(); caps->setProperty("webaudioFallback", false); caps->setProperty("projectSync", true); juce::DynamicObject::Ptr d=new juce::DynamicObject(); d->setProperty("protocol","SLS-IPC/1.0"); d->setProperty("engineName","sls-audio-engine"); d->setProperty("engineVersion","0.2.0"); d->setProperty("platform", juce::SystemStats::getOperatingSystemName()); d->setProperty("pid", SLS_GET_PID()); d->setProperty("capabilities", juce::var(caps.get())); return juce::var(d.get()); }
  juce::var engineState(){ juce::DynamicObject::Ptr d=new juce::DynamicObject(); d->setProperty("ready",ready); d->setProperty("sampleRate",sampleRate); d->setProperty("bufferSize",bufferSize); d->setProperty("cpuLoad",0.0); d->setProperty("xruns",0); return juce::var(d.get()); }
  juce::var engineConfig(){ juce::DynamicObject::Ptr d=new juce::DynamicObject(); d->setProperty("sampleRate",sampleRate); d->setProperty("bufferSize",bufferSize); d->setProperty("numOut",numOut); d->setProperty("numIn",numIn); return juce::var(d.get()); }
  juce::var transportState(){ juce::DynamicObject::Ptr d=new juce::DynamicObject(); d->setProperty("playing",playing); d->setProperty("bpm",bpm); d->setProperty("ppq",samplesToPpq(samplePos)); d->setProperty("samplePos",(int)samplePos); return juce::var(d.get()); }
  juce::var meterData(){ juce::Array<juce::var> frames; auto add=[&](int ch,float rL,float rR,float pL,float pR){ juce::DynamicObject::Ptr f=new juce::DynamicObject(); juce::Array<juce::var> rms{rL,rR}; juce::Array<juce::var> peak{pL,pR}; f->setProperty("ch",ch); f->setProperty("rms",juce::var(rms)); f->setProperty("peak",juce::var(peak)); frames.add(juce::var(f.get()));}; if(meterChannels.count(-1)) add(-1,meterRmsL,meterRmsR,meterPeakL,meterPeakR); for(int ch=0; ch<channelCount; ++ch) if(meterChannels.count(ch)) add(ch,0,0,0,0); juce::DynamicObject::Ptr d=new juce::DynamicObject(); d->setProperty("frames",juce::var(frames)); meterPeakL=0; meterPeakR=0; return juce::var(d.get()); }

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
  Engine engine; std::string line; while(engine.isRunning() && std::getline(std::cin,line)){ if(line.empty()) continue; juce::var msg; if(juce::JSON::parse(line,msg).wasOk()) engine.handle(msg); }
  return 0;
}
