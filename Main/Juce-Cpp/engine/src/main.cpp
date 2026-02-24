#include <atomic>
#include <cmath>
#include <iostream>
#include <mutex>
#include <thread>
#include <unordered_map>
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

static double clamp01(double v, double def = 0.0)
{
    if (std::isnan(v) || std::isinf(v)) return def;
    if (v < 0.0) return 0.0;
    if (v > 1.0) return 1.0;
    return v;
}

static double getDoubleProp(const juce::DynamicObject* o, const char* key, double def)
{
    if (o == nullptr) return def;
    const auto v = o->getProperty(juce::Identifier(key));
    if (v.isDouble() || v.isInt()) return (double) v;
    return def;
}

static int getIntProp(const juce::DynamicObject* o, const char* key, int def)
{
    if (o == nullptr) return def;
    const auto v = o->getProperty(juce::Identifier(key));
    if (v.isInt()) return (int) v;
    if (v.isDouble()) return (int) (double) v;
    return def;
}

static juce::String getStringProp(const juce::DynamicObject* o, const char* key, const juce::String& def = {})
{
    if (o == nullptr) return def;
    const auto v = o->getProperty(juce::Identifier(key));
    return v.isString() ? v.toString() : def;
}

static int hashString(const juce::String& s)
{
    // FNV-1a 32-bit
    uint32_t h = 2166136261u;
    auto utf8 = s.toRawUTF8();
    for (const unsigned char* p = (const unsigned char*) utf8; *p; ++p)
        h = (h ^ *p) * 16777619u;
    return (int) h;
}

// ---------------- Synth voice (simple sine) ----------------
struct Voice {
    int note = 60;
    float velocity = 0.8f;
    double phase = 0.0;
    double phaseInc = 0.0;
    bool active = false;
};

// ---------------- Sample voices ----------------
struct SampleData {
    double sampleRate = 48000.0;
    juce::AudioBuffer<float> buffer;
};

struct SampleVoice {
    std::shared_ptr<const SampleData> sample;
    int start = 0;
    int end = 0;       // exclusive
    double pos = 0.0;  // in samples (fractional)
    double rate = 1.0;
    float gainL = 1.0f;
    float gainR = 1.0f;
    int fadeIn = 0;
    int fadeOut = 0;
    bool active = false;
};

// ---------------- Scheduled MIDI note (existing) ----------------
struct ScheduledNote {
    int trackHash = 0;
    int note = 60;
    float vel = 0.8f;
    juce::int64 startSample = 0;
    juce::int64 endSample = 0;
    bool noteOnSent = false;
    bool noteOffSent = false;
};

class Engine : public juce::AudioIODeviceCallback {
public:
    Engine()
    {
        voices.reserve(kMaxSynthVoices);
        sampleVoices.reserve(kMaxSampleVoices);
        formatManager.registerBasicFormats();

        setupAudio();
        // Emit initial state once
        emitEvt("engine.state", engineState());
        emitEvt("transport.state", transportState());

        stateThread = std::thread([this]() { pumpStateEvents(); });
    }

    ~Engine() override
    {
        running = false;
        if (stateThread.joinable()) stateThread.join();
        shutdownAudio();
    }

    // ---------------- Audio device ----------------
    void setupAudio()
    {
        juce::AudioDeviceManager::AudioDeviceSetup setup;
        setup.sampleRate = sampleRate;
        setup.bufferSize = bufferSize;
        setup.inputChannels.clear();
        setup.outputChannels = juce::BigInteger().setRange(0, numOut, true);

        auto err = deviceManager.initialise(numIn, numOut, nullptr, true, {}, &setup);
        if (err.isNotEmpty()) {
            emitError("E_DEVICE_FAIL", err);
            ready = false;
            return;
        }

        deviceManager.addAudioCallback(this);

        if (auto* dev = deviceManager.getCurrentAudioDevice()) {
            sampleRate = dev->getCurrentSampleRate();
            bufferSize = dev->getCurrentBufferSizeSamples();
            ready = true;
        } else {
            ready = false;
        }
    }

    void shutdownAudio()
    {
        deviceManager.removeAudioCallback(this);
        deviceManager.closeAudioDevice();
        ready = false;
    }

    void audioDeviceIOCallbackWithContext(const float* const*, int,
                                          float* const* outputChannelData,
                                          int numOutputChannels,
                                          int numSamples,
                                          const juce::AudioIODeviceCallbackContext&) override
    {
        juce::ScopedLock sl(audioLock);

        for (int ch = 0; ch < numOutputChannels; ++ch)
            if (outputChannelData[ch] != nullptr)
                juce::FloatVectorOperations::clear(outputChannelData[ch], numSamples);

        // Do NOT advance timeline when stopped.
        if (!playing) return;

        const auto blockStart = samplePos;
        const auto blockEnd = samplePos + numSamples;

        // Scheduled MIDI (sine)
        for (auto& e : scheduled) {
            if (!e.noteOnSent && e.startSample >= blockStart && e.startSample < blockEnd) {
                startVoice(e.note, e.vel);
                e.noteOnSent = true;
            }
            if (!e.noteOffSent && e.endSample >= blockStart && e.endSample < blockEnd) {
                stopVoice(e.note);
                e.noteOffSent = true;
            }
        }

        // Render each sample frame
        for (int i = 0; i < numSamples; ++i) {
            float outL = 0.0f;
            float outR = 0.0f;

            // Sample voices
            for (auto& sv : sampleVoices) {
                if (!sv.active || !sv.sample) continue;
                const auto& buf = sv.sample->buffer;
                const int total = buf.getNumSamples();
                if (total <= 0) { sv.active = false; continue; }

                const int ipos = (int) sv.pos;
                if (ipos >= sv.end || ipos >= total - 1) { sv.active = false; continue; }
                if (ipos < sv.start) { sv.pos += sv.rate; continue; }

                // Linear interpolation
                const float frac = (float) (sv.pos - ipos);
                const int chN = buf.getNumChannels();
                const float s0L = buf.getSample(0, ipos);
                const float s1L = buf.getSample(0, ipos + 1);
                float sL = s0L + (s1L - s0L) * frac;

                float sR = sL;
                if (chN > 1) {
                    const float s0R = buf.getSample(1, ipos);
                    const float s1R = buf.getSample(1, ipos + 1);
                    sR = s0R + (s1R - s0R) * frac;
                }

                // Simple fade-in/out (samples)
                float amp = 1.0f;
                const int rel = ipos - sv.start;
                const int remain = sv.end - ipos;
                if (sv.fadeIn > 0 && rel < sv.fadeIn) amp *= (float) rel / (float) sv.fadeIn;
                if (sv.fadeOut > 0 && remain < sv.fadeOut) amp *= (float) remain / (float) sv.fadeOut;

                outL += sL * sv.gainL * amp;
                outR += sR * sv.gainR * amp;

                sv.pos += sv.rate;
            }

            // Simple sine synth (mono -> stereo)
            float out = 0.0f;
            for (auto& v : voices) {
                if (!v.active) continue;
                out += std::sin(v.phase) * v.velocity * 0.15f;
                v.phase += v.phaseInc;
                if (v.phase > kTwoPi) v.phase -= kTwoPi;
            }
            outL += out;
            outR += out;

            // Write
            if (numOutputChannels > 0 && outputChannelData[0]) outputChannelData[0][i] = outL;
            if (numOutputChannels > 1 && outputChannelData[1]) outputChannelData[1][i] = outR;
            for (int ch = 2; ch < numOutputChannels; ++ch)
                if (outputChannelData[ch]) outputChannelData[ch][i] = 0.5f * (outL + outR);
        }

        samplePos += numSamples;
    }

    void audioDeviceAboutToStart(juce::AudioIODevice* d) override
    {
        juce::ScopedLock sl(audioLock);
        if (d != nullptr) {
            sampleRate = d->getCurrentSampleRate();
            bufferSize = d->getCurrentBufferSizeSamples();
            ready = true;
        }
    }

    void audioDeviceStopped() override {}

    // ---------------- IPC handler ----------------
    void handle(const juce::var& msg)
    {
        auto* obj = msg.getDynamicObject();
        if (!obj) return;

        const auto type = obj->getProperty("type").toString();
        if (type != "req") return; // ignore anything else

        const auto op = obj->getProperty("op").toString();
        const auto id = obj->getProperty("id").toString();
        const auto data = obj->getProperty("data");

        if (op == "engine.hello") return resOk(op, id, helloData());
        if (op == "engine.ping")  return resOk(op, id, data);
        if (op == "engine.getState") return resOk(op, id, engineState());

        if (op == "engine.setConfig") {
            const auto* d = data.getDynamicObject();
            if (!d) return resErr(op, id, "E_BAD_ENVELOPE", "Missing data object");
            sampleRate = std::max(22050.0, getDoubleProp(d, "sampleRate", sampleRate));
            bufferSize = std::max(64, getIntProp(d, "bufferSize", bufferSize));
            numOut = std::max(1, getIntProp(d, "numOut", numOut));
            numIn = std::max(0, getIntProp(d, "numIn", numIn));
            shutdownAudio();
            setupAudio();

            juce::DynamicObject::Ptr r = new juce::DynamicObject();
            r->setProperty("sampleRate", sampleRate);
            r->setProperty("bufferSize", bufferSize);
            r->setProperty("numOut", numOut);
            r->setProperty("numIn", numIn);
            resOk(op, id, juce::var(r.get()));
            emitEvt("engine.state", engineState());
            return;
        }

        // -------- sampler.load --------
        if (op == "sampler.load") {
            const auto* d = data.getDynamicObject();
            if (!d) return resErr(op, id, "E_BAD_ENVELOPE", "Missing sampler.load data");
            const auto sampleId = getStringProp(d, "sampleId", "");
            const auto path = getStringProp(d, "path", "");
            if (sampleId.isEmpty() || path.isEmpty())
                return resErr(op, id, "E_BAD_ENVELOPE", "sampleId/path required");

            juce::File f(path);
            if (!f.existsAsFile())
                return resErr(op, id, "E_LOAD_FAIL", "File not found");

            std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(f));
            if (!reader)
                return resErr(op, id, "E_LOAD_FAIL", "Unsupported format");

            auto sd = std::make_shared<SampleData>();
            sd->sampleRate = reader->sampleRate;
            sd->buffer.setSize((int) reader->numChannels, (int) reader->lengthInSamples);
            reader->read(&sd->buffer, 0, (int) reader->lengthInSamples, 0, true, true);

            {
                juce::ScopedLock sl(audioLock);
                sampleCache[sampleId] = sd;
            }

            juce::DynamicObject::Ptr r = new juce::DynamicObject();
            r->setProperty("sampleId", sampleId);
            r->setProperty("frames", sd->buffer.getNumSamples());
            r->setProperty("channels", sd->buffer.getNumChannels());
            r->setProperty("sampleRate", sd->sampleRate);
            return resOk(op, id, juce::var(r.get()));
        }

        // -------- sampler.trigger --------
        if (op == "sampler.trigger") {
            const auto* d = data.getDynamicObject();
            if (!d) return resErr(op, id, "E_BAD_ENVELOPE", "Missing sampler.trigger data");
            const auto sampleId = getStringProp(d, "sampleId", "");
            if (sampleId.isEmpty())
                return resErr(op, id, "E_BAD_ENVELOPE", "sampleId required");

            std::shared_ptr<const SampleData> sd;
            {
                juce::ScopedLock sl(audioLock);
                auto it = sampleCache.find(sampleId);
                if (it != sampleCache.end())
                    sd = it->second;
            }
            if (!sd)
                return resErr(op, id, "E_NOT_LOADED", "sampleId not loaded");

            const auto startNorm = clamp01(getDoubleProp(d, "startNorm", 0.0), 0.0);
            const auto endNormRaw = clamp01(getDoubleProp(d, "endNorm", 1.0), 1.0);
            const auto endNorm = std::max(startNorm + 1e-6, endNormRaw);

            const auto note = getIntProp(d, "note", 60);
            const auto rootMidi = getIntProp(d, "rootMidi", 60);
            const auto velocity = (float) juce::jlimit(0.0, 1.0, getDoubleProp(d, "velocity", 0.85));
            const auto gain = (float) juce::jmax(0.0, getDoubleProp(d, "gain", 1.0));
            const auto pan = (float) juce::jlimit(-1.0, 1.0, getDoubleProp(d, "pan", 0.0));

            const auto total = sd->buffer.getNumSamples();
            int startS = (int) std::floor(startNorm * (double) total);
            int endS = (int) std::ceil(endNorm * (double) total);
            startS = juce::jlimit(0, std::max(0, total - 2), startS);
            endS = juce::jlimit(startS + 1, total, endS);

            // Pitch: resample ratio
            const double semis = (double) (note - rootMidi);
            const double rate = std::pow(2.0, semis / 12.0);

            const float baseGain = gain * velocity;
            const float gL = baseGain * 0.5f * (1.0f - pan);
            const float gR = baseGain * 0.5f * (1.0f + pan);

            SampleVoice v;
            v.sample = sd;
            v.start = startS;
            v.end = endS;
            v.pos = (double) startS;
            v.rate = rate;
            v.gainL = gL;
            v.gainR = gR;
            v.fadeIn = (int) std::max(1.0, 0.003 * sampleRate);  // 3ms
            v.fadeOut = (int) std::max(1.0, 0.003 * sampleRate);
            v.active = true;

            {
                juce::ScopedLock sl(audioLock);
                // reuse inactive slot
                bool placed = false;
                for (auto& sv : sampleVoices) {
                    if (!sv.active) { sv = v; placed = true; break; }
                }
                if (!placed && (int) sampleVoices.size() < kMaxSampleVoices)
                    sampleVoices.push_back(v);
            }

            return resOk(op, id, juce::var());
        }

        if (op == "transport.setTempo") {
            const auto* d = data.getDynamicObject();
            bpm = d ? std::max(20.0, getDoubleProp(d, "bpm", bpm)) : bpm;
            resOk(op, id, juce::var());
            return emitEvt("transport.state", transportState());
        }

        if (op == "transport.play") {
            {
                juce::ScopedLock sl(audioLock);
                playing = true;
            }
            resOk(op, id, juce::var());
            return emitEvt("transport.state", transportState());
        }

        if (op == "transport.stop") {
            {
                juce::ScopedLock sl(audioLock);
                playing = false;
                panic();
            }
            resOk(op, id, juce::var());
            return emitEvt("transport.state", transportState());
        }

        if (op == "transport.seek") {
            const auto* d = data.getDynamicObject();
            const double ppq = d ? getDoubleProp(d, "ppq", 0.0) : 0.0;
            {
                juce::ScopedLock sl(audioLock);
                panic();
                samplePos = ppqToSamples(ppq);
                for (auto& e : scheduled) {
                    e.noteOnSent = e.startSample < samplePos;
                    e.noteOffSent = e.endSample < samplePos;
                }
            }
            resOk(op, id, juce::var());
            return emitEvt("transport.state", transportState());
        }

        if (op == "transport.getState") return resOk(op, id, transportState());

        if (op == "midi.noteOn") {
            const auto* d = data.getDynamicObject();
            if (!d) return resErr(op, id, "E_BAD_ENVELOPE", "Missing midi.noteOn data");
            juce::ScopedLock sl(audioLock);
            startVoice(getIntProp(d, "note", 60), (float) getDoubleProp(d, "velocity", 0.8));
            return resOk(op, id, juce::var());
        }

        if (op == "midi.noteOff") {
            const auto* d = data.getDynamicObject();
            if (!d) return resErr(op, id, "E_BAD_ENVELOPE", "Missing midi.noteOff data");
            juce::ScopedLock sl(audioLock);
            stopVoice(getIntProp(d, "note", 60));
            return resOk(op, id, juce::var());
        }

        if (op == "midi.panic") {
            juce::ScopedLock sl(audioLock);
            panic();
            return resOk(op, id, juce::var());
        }

        if (op == "project.sync") {
            parseProject(data);
            juce::DynamicObject::Ptr r = new juce::DynamicObject();
            r->setProperty("accepted", true);
            r->setProperty("projectId", data.getProperty("projectId", "unknown"));
            resOk(op, id, juce::var(r.get()));
            emitEvt("engine.state", engineState());
            emitEvt("transport.state", transportState());
            return;
        }

        if (op == "engine.shutdown") {
            running = false;
            return resOk(op, id, juce::var());
        }

        return resErr(op, id, "E_UNKNOWN_OP", "Unknown opcode");
    }

    bool isRunning() const { return running.load(); }

private:
    juce::AudioDeviceManager deviceManager;
    juce::AudioFormatManager formatManager;

    juce::CriticalSection audioLock;
    std::vector<Voice> voices;
    std::vector<SampleVoice> sampleVoices;
    std::vector<ScheduledNote> scheduled;
    std::unordered_map<juce::String, std::shared_ptr<SampleData>> sampleCache;

    std::atomic<bool> running { true };
    std::thread stateThread;

    bool ready = false;
    bool playing = false;
    double bpm = 120.0;
    double sampleRate = 48000.0;
    int bufferSize = 512;
    int numOut = 2;
    int numIn = 0;
    juce::int64 samplePos = 0;

    double mtof(int note) const { return 440.0 * std::pow(2.0, (note - 69) / 12.0); }

    juce::int64 ppqToSamples(double ppq) const {
        const auto sec = (60.0 / std::max(20.0, bpm)) * ppq;
        return (juce::int64) std::llround(sec * sampleRate);
    }

    double samplesToPpq(juce::int64 samples) const {
        const auto sec = (double) samples / std::max(1.0, sampleRate);
        return (sec / (60.0 / std::max(20.0, bpm)));
    }

    void startVoice(int note, float vel) {
        // reuse existing
        for (auto& v : voices) {
            if (v.active && v.note == note) { v.velocity = vel; return; }
        }
        if ((int) voices.size() < kMaxSynthVoices) voices.push_back(Voice{});
        for (auto& v : voices) {
            if (!v.active) {
                v.note = note;
                v.velocity = vel;
                v.phase = 0.0;
                v.phaseInc = kTwoPi * mtof(note) / std::max(1.0, sampleRate);
                v.active = true;
                return;
            }
        }
        // fallback overwrite first
        voices[0].note = note;
        voices[0].velocity = vel;
        voices[0].phase = 0.0;
        voices[0].phaseInc = kTwoPi * mtof(note) / std::max(1.0, sampleRate);
        voices[0].active = true;
    }

    void stopVoice(int note) {
        for (auto& v : voices)
            if (v.active && v.note == note)
                v.active = false;
    }

    void panic() {
        for (auto& v : voices) v.active = false;
        for (auto& sv : sampleVoices) sv.active = false;
    }

    juce::var helloData() {
        juce::DynamicObject::Ptr caps = new juce::DynamicObject();
        caps->setProperty("webaudioFallback", true);
        caps->setProperty("projectSync", true);
        caps->setProperty("vst3", false);
        caps->setProperty("audioInput", false);

        juce::DynamicObject::Ptr d = new juce::DynamicObject();
        d->setProperty("protocol", "SLS-IPC/1.0");
        d->setProperty("engineName", "sls-audio-engine");
        d->setProperty("engineVersion", "0.1.0");
        d->setProperty("platform", "Linux");
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
        d->setProperty("backend", "juce");
        return juce::var(d.get());
    }

    juce::var transportState() {
        juce::DynamicObject::Ptr d = new juce::DynamicObject();
        d->setProperty("playing", playing);
        d->setProperty("bpm", bpm);
        d->setProperty("ppq", samplesToPpq(samplePos));
        d->setProperty("samplePos", (int) samplePos);
        return juce::var(d.get());
    }

    void parseProject(const juce::var&) {
        // keep existing behaviour: accept sync, but not implementing scheduling here
    }

    void writeJsonLine(const juce::var& obj) {
        // one-line JSONL
        std::cout << juce::JSON::toString(obj, true).toStdString() << "\n";
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
        writeJsonLine(juce::var(o.get()));
    }

    void resErr(const juce::String& op, const juce::String& id, const juce::String& code, const juce::String& message) {
        juce::DynamicObject::Ptr err = new juce::DynamicObject();
        err->setProperty("code", code);
        err->setProperty("message", message);

        juce::DynamicObject::Ptr o = new juce::DynamicObject();
        o->setProperty("v", 1);
        o->setProperty("type", "res");
        o->setProperty("op", op);
        o->setProperty("id", id);
        o->setProperty("ts", nowMs());
        o->setProperty("ok", false);
        o->setProperty("err", juce::var(err.get()));
        writeJsonLine(juce::var(o.get()));
    }

    void emitEvt(const juce::String& op, const juce::var& data) {
        juce::DynamicObject::Ptr o = new juce::DynamicObject();
        o->setProperty("v", 1);
        o->setProperty("type", "evt");
        o->setProperty("op", op);
        o->setProperty("id", "evt-" + juce::String(nowMs()));
        o->setProperty("ts", nowMs());
        o->setProperty("data", data);
        writeJsonLine(juce::var(o.get()));
    }

    void emitError(const juce::String& code, const juce::String& message) {
        juce::DynamicObject::Ptr d = new juce::DynamicObject();
        d->setProperty("code", code);
        d->setProperty("message", message);
        emitEvt("engine.error", juce::var(d.get()));
    }

    void pumpStateEvents() {
        // 1 Hz max
        juce::var lastEng;
        juce::var lastTr;
        bool first = true;
        while (running) {
            std::this_thread::sleep_for(std::chrono::milliseconds(1000));

            auto es = engineState();
            auto ts = transportState();

            const auto esStr = juce::JSON::toString(es, true);
            const auto tsStr = juce::JSON::toString(ts, true);

            if (first || esStr != juce::JSON::toString(lastEng, true)) {
                emitEvt("engine.state", es);
                lastEng = es;
            }
            if (first || tsStr != juce::JSON::toString(lastTr, true)) {
                emitEvt("transport.state", ts);
                lastTr = ts;
            }
            first = false;
        }
    }
};

} // namespace

int main()
{
    Engine engine;

    std::string line;
    while (engine.isRunning() && std::getline(std::cin, line)) {
        if (line.empty()) continue;
        juce::var msg;
        if (!juce::JSON::parse(line, msg).wasOk()) continue;
        engine.handle(msg);
    }
    return 0;
}
