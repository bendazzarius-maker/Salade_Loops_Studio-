#include <atomic>
#include <cmath>
#include <iostream>
#include <memory>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <vector>

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>

namespace {
constexpr double kTwoPi = 6.283185307179586;

juce::int64 nowMs() { return juce::Time::currentTimeMillis(); }

double clamp01(double v, double d = 0.0) {
    if (!std::isfinite(v)) return d;
    return juce::jlimit(0.0, 1.0, v);
}

struct Voice {
    int note = 60;
    float velocity = 0.8f;
    double phase = 0.0;
    double phaseInc = 0.0;
    bool active = false;
};

struct ScheduledNote {
    int trackHash = 0;
    int note = 60;
    float vel = 0.8f;
    juce::int64 startSample = 0;
    juce::int64 endSample = 0;
    bool noteOnSent = false;
    bool noteOffSent = false;
};

struct SampleData {
    juce::AudioBuffer<float> buffer;
    double sampleRate = 44100.0;
};

struct SampleVoice {
    std::shared_ptr<SampleData> sample;
    double pos = 0.0;
    double end = 0.0;
    double rate = 1.0;
    float gainL = 1.0f;
    float gainR = 1.0f;
    int fadeInSamples = 48;
    int fadeOutSamples = 64;
    int playedSamples = 0;
    bool active = false;
};

class Engine : public juce::AudioIODeviceCallback {
public:
    Engine() {
        formatManager.registerBasicFormats();
    }

    void setupAudio() {
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
        ready = true;
    }

    void shutdownAudio() {
        deviceManager.removeAudioCallback(this);
        deviceManager.closeAudioDevice();
        ready = false;
    }

    void audioDeviceIOCallbackWithContext(const float* const*, int, float* const* outputChannelData,
                                          int numOutputChannels, int numSamples,
                                          const juce::AudioIODeviceCallbackContext&) override {
        juce::ScopedLock sl(audioLock);
        for (int ch = 0; ch < numOutputChannels; ++ch) {
            if (outputChannelData[ch] != nullptr) {
                juce::FloatVectorOperations::clear(outputChannelData[ch], numSamples);
            }
        }

        if (!playing) {
            samplePos += numSamples;
            return;
        }

        const auto blockStart = samplePos;
        const auto blockEnd = samplePos + numSamples;

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

        for (int i = 0; i < numSamples; ++i) {
            float outL = 0.0f;
            float outR = 0.0f;

            for (auto& v : voices) {
                if (!v.active) continue;
                const auto val = std::sin(v.phase) * v.velocity * 0.15f;
                outL += val;
                outR += val;
                v.phase += v.phaseInc;
                if (v.phase > kTwoPi) v.phase -= kTwoPi;
            }

            for (auto& sv : sampleVoices) {
                if (!sv.active || !sv.sample) continue;
                const auto& b = sv.sample->buffer;
                const int channels = b.getNumChannels();
                const int maxSample = b.getNumSamples();
                if (channels <= 0 || maxSample <= 1) {
                    sv.active = false;
                    continue;
                }

                if (sv.pos >= sv.end || sv.pos >= static_cast<double>(maxSample - 1)) {
                    sv.active = false;
                    continue;
                }

                const int idx = static_cast<int>(sv.pos);
                const int idxN = juce::jmin(idx + 1, maxSample - 1);
                const float frac = static_cast<float>(sv.pos - static_cast<double>(idx));

                float mono = 0.0f;
                for (int ch = 0; ch < channels; ++ch) {
                    const float* rd = b.getReadPointer(ch);
                    mono += rd[idx] + (rd[idxN] - rd[idx]) * frac;
                }
                mono /= static_cast<float>(channels);

                float env = 1.0f;
                if (sv.playedSamples < sv.fadeInSamples) {
                    env *= static_cast<float>(sv.playedSamples) / static_cast<float>(juce::jmax(1, sv.fadeInSamples));
                }
                const int remain = static_cast<int>(juce::jmax(0.0, sv.end - sv.pos));
                if (remain < sv.fadeOutSamples) {
                    env *= static_cast<float>(remain) / static_cast<float>(juce::jmax(1, sv.fadeOutSamples));
                }

                outL += mono * sv.gainL * env;
                outR += mono * sv.gainR * env;
                sv.pos += sv.rate;
                sv.playedSamples += 1;
            }

            if (numOutputChannels > 0 && outputChannelData[0] != nullptr) outputChannelData[0][i] = outL;
            if (numOutputChannels > 1 && outputChannelData[1] != nullptr) outputChannelData[1][i] = outR;
            for (int ch = 2; ch < numOutputChannels; ++ch) {
                if (outputChannelData[ch] != nullptr) outputChannelData[ch][i] = 0.5f * (outL + outR);
            }
        }

        sampleVoices.erase(std::remove_if(sampleVoices.begin(), sampleVoices.end(), [](const SampleVoice& v) {
            return !v.active;
        }), sampleVoices.end());

        samplePos += numSamples;
    }

    void audioDeviceAboutToStart(juce::AudioIODevice* d) override {
        juce::ScopedLock sl(audioLock);
        if (d != nullptr) {
            sampleRate = d->getCurrentSampleRate();
            bufferSize = d->getCurrentBufferSizeSamples();
        }
    }

    void audioDeviceStopped() override {}

    void handle(const juce::var& msg) {
        auto* obj = msg.getDynamicObject();
        if (!obj) return;

        auto op = obj->getProperty("op").toString();
        auto id = obj->getProperty("id").toString();
        auto data = obj->getProperty("data");

        if (op == "engine.hello") return resOk(op, id, helloData());
        if (op == "engine.ping") return resOk(op, id, data);
        if (op == "engine.getState") return resOk(op, id, engineState());

        if (op == "engine.setConfig") {
            const auto* d = data.getDynamicObject();
            if (!d) return resErr(op, id, "E_BAD_ENVELOPE", "Missing data object");
            sampleRate = std::max(22050.0, d->getProperty("sampleRate", sampleRate));
            bufferSize = std::max(64, static_cast<int>(d->getProperty("bufferSize", bufferSize)));
            numOut = std::max(1, static_cast<int>(d->getProperty("numOut", numOut)));
            numIn = std::max(0, static_cast<int>(d->getProperty("numIn", numIn)));
            setupAudio();

            juce::DynamicObject::Ptr r = new juce::DynamicObject();
            r->setProperty("sampleRate", sampleRate);
            r->setProperty("bufferSize", bufferSize);
            r->setProperty("numOut", numOut);
            r->setProperty("numIn", numIn);
            return resOk(op, id, juce::var(r.get()));
        }

        if (op == "transport.setTempo") {
            const auto* d = data.getDynamicObject();
            bpm = d ? std::max(20.0, d->getProperty("bpm", bpm)) : bpm;
            resOk(op, id, juce::var());
            return transportEvt();
        }

        if (op == "transport.play") {
            {
                juce::ScopedLock sl(audioLock);
                playing = true;
            }
            resOk(op, id, juce::var());
            return transportEvt();
        }

        if (op == "transport.stop") {
            {
                juce::ScopedLock sl(audioLock);
                playing = false;
                panic();
            }
            resOk(op, id, juce::var());
            return transportEvt();
        }

        if (op == "transport.seek") {
            const auto* d = data.getDynamicObject();
            double ppq = d ? static_cast<double>(d->getProperty("ppq", 0.0)) : 0.0;
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
            return transportEvt();
        }

        if (op == "transport.getState") {
            return resOk(op, id, transportState());
        }

        if (op == "midi.noteOn") {
            const auto* d = data.getDynamicObject();
            if (!d) return resErr(op, id, "E_BAD_ENVELOPE", "Missing midi.noteOn data");
            juce::ScopedLock sl(audioLock);
            startVoice(static_cast<int>(d->getProperty("note", 60)), static_cast<float>(d->getProperty("velocity", 0.8)));
            return resOk(op, id, juce::var());
        }

        if (op == "midi.noteOff") {
            const auto* d = data.getDynamicObject();
            if (!d) return resErr(op, id, "E_BAD_ENVELOPE", "Missing midi.noteOff data");
            juce::ScopedLock sl(audioLock);
            stopVoice(static_cast<int>(d->getProperty("note", 60)));
            return resOk(op, id, juce::var());
        }

        if (op == "midi.panic") {
            juce::ScopedLock sl(audioLock);
            panic();
            return resOk(op, id, juce::var());
        }

        if (op == "sampler.load") {
            const auto* d = data.getDynamicObject();
            if (!d) return resErr(op, id, "E_BAD_ENVELOPE", "Missing sampler.load data");
            const auto sampleId = d->getProperty("sampleId", "").toString();
            const auto path = d->getProperty("path", "").toString();
            if (sampleId.isEmpty() || path.isEmpty()) return resErr(op, id, "E_BAD_ARGS", "sampleId/path required");
            juce::String err;
            const bool ok = loadSample(sampleId, path, err);
            if (!ok) return resErr(op, id, "E_SAMPLE_LOAD", err.isNotEmpty() ? err : "Unable to load sample");

            juce::DynamicObject::Ptr r = new juce::DynamicObject();
            r->setProperty("sampleId", sampleId);
            r->setProperty("loaded", true);
            return resOk(op, id, juce::var(r.get()));
        }

        if (op == "sampler.trigger") {
            const auto* d = data.getDynamicObject();
            if (!d) return resErr(op, id, "E_BAD_ENVELOPE", "Missing sampler.trigger data");
            const auto sampleId = d->getProperty("sampleId", "").toString();
            auto sample = getSample(sampleId);
            if (!sample) return resErr(op, id, "E_SAMPLE_MISSING", "Sample not loaded");

            const auto startNorm = clamp01(static_cast<double>(d->getProperty("startNorm", 0.0)), 0.0);
            const auto endNormRaw = clamp01(static_cast<double>(d->getProperty("endNorm", 1.0)), 1.0);
            const auto endNorm = std::max(startNorm + 0.001, endNormRaw);

            const int totalSamples = sample->buffer.getNumSamples();
            if (totalSamples < 2) return resErr(op, id, "E_SAMPLE_EMPTY", "Sample has no audio data");

            const auto startSample = juce::jlimit(0.0, static_cast<double>(totalSamples - 2), startNorm * totalSamples);
            const auto endSample = juce::jlimit(startSample + 1.0, static_cast<double>(totalSamples - 1), endNorm * totalSamples);

            const auto note = static_cast<int>(d->getProperty("note", 60));
            const auto rootMidi = static_cast<int>(d->getProperty("rootMidi", 60));
            const auto velocity = static_cast<float>(juce::jlimit(0.0, 1.0, static_cast<double>(d->getProperty("velocity", 0.85))));
            const auto gain = static_cast<float>(juce::jmax(0.0, static_cast<double>(d->getProperty("gain", 1.0))));
            const auto pan = static_cast<float>(juce::jlimit(-1.0, 1.0, static_cast<double>(d->getProperty("pan", 0.0))));

            const double pitchRatio = std::pow(2.0, (static_cast<double>(note - rootMidi)) / 12.0);
            const double srcToOut = sample->sampleRate / std::max(22050.0, sampleRate);
            const double rate = std::max(0.01, pitchRatio * srcToOut);

            const float panRad = (pan + 1.0f) * 0.25f * juce::MathConstants<float>::pi;
            const float gainL = std::cos(panRad) * gain * velocity;
            const float gainR = std::sin(panRad) * gain * velocity;

            SampleVoice v;
            v.sample = sample;
            v.pos = startSample;
            v.end = endSample;
            v.rate = rate;
            v.gainL = gainL;
            v.gainR = gainR;
            v.fadeInSamples = 48;
            v.fadeOutSamples = 64;
            v.playedSamples = 0;
            v.active = true;

            {
                juce::ScopedLock sl(audioLock);
                sampleVoices.push_back(v);
            }
            return resOk(op, id, juce::var());
        }

        if (op == "project.sync") {
            parseProject(data);
            juce::DynamicObject::Ptr r = new juce::DynamicObject();
            r->setProperty("accepted", true);
            r->setProperty("projectId", data.getProperty("projectId", "unknown"));
            return resOk(op, id, juce::var(r.get()));
        }

        if (op == "engine.shutdown") {
            running = false;
            return resOk(op, id, juce::var());
        }

        return resErr(op, id, "E_UNKNOWN_OP", "Unknown opcode");
    }

    void pumpStateEvents() {
        while (running) {
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
            emitEvt("engine.state", engineState());
            emitEvt("transport.state", transportState());
        }
    }

    bool isRunning() const { return running.load(); }

private:
    juce::AudioDeviceManager deviceManager;
    juce::AudioFormatManager formatManager;
    juce::CriticalSection audioLock;
    std::vector<Voice> voices;
    std::vector<SampleVoice> sampleVoices;
    std::vector<ScheduledNote> scheduled;

    std::mutex sampleMutex;
    std::unordered_map<juce::String, std::shared_ptr<SampleData>> sampleCache;

    std::atomic<bool> running { true };
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
        const auto sec = (60.0 / std::max(20.0, bpm)) * (ppq / 1.0);
        return static_cast<juce::int64>(sec * sampleRate);
    }

    void startVoice(int note, float vel) {
        for (auto& v : voices) {
            if (v.active && v.note == note) {
                v.velocity = vel;
                return;
            }
        }
        Voice v;
        v.note = note;
        v.velocity = vel;
        v.phase = 0.0;
        v.phaseInc = (kTwoPi * mtof(note)) / sampleRate;
        v.active = true;
        voices.push_back(v);
    }

    void stopVoice(int note) {
        for (auto& v : voices) {
            if (v.active && v.note == note) v.active = false;
        }
    }

    void panic() {
        for (auto& v : voices) v.active = false;
        for (auto& v : sampleVoices) v.active = false;
    }

    bool loadSample(const juce::String& sampleId, const juce::String& path, juce::String& err) {
        juce::File f(path);
        if (!f.existsAsFile()) {
            err = "File not found";
            return false;
        }

        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(f));
        if (!reader) {
            err = "Unsupported or unreadable file";
            return false;
        }

        auto data = std::make_shared<SampleData>();
        const int channels = juce::jmax(1, static_cast<int>(reader->numChannels));
        const int samples = static_cast<int>(reader->lengthInSamples);
        if (samples <= 1) {
            err = "Sample is empty";
            return false;
        }

        data->buffer.setSize(channels, samples);
        if (!reader->read(&data->buffer, 0, samples, 0, true, true)) {
            err = "Reader failed";
            return false;
        }
        data->sampleRate = reader->sampleRate;

        std::lock_guard<std::mutex> lk(sampleMutex);
        sampleCache[sampleId] = data;
        return true;
    }

    std::shared_ptr<SampleData> getSample(const juce::String& sampleId) {
        std::lock_guard<std::mutex> lk(sampleMutex);
        auto it = sampleCache.find(sampleId);
        if (it == sampleCache.end()) return nullptr;
        return it->second;
    }

    void parseProject(const juce::var& data) {
        const auto* d = data.getDynamicObject();
        if (!d) return;
        const auto ppqResolution = static_cast<double>(d->getProperty("ppqResolution", 960));
        const auto patterns = d->getProperty("patterns");
        const auto arrangement = d->getProperty("arrangement");

        std::unordered_map<juce::String, juce::Array<juce::var>> notesByPattern;
        if (auto* pArr = patterns.getArray()) {
            for (const auto& p : *pArr) {
                auto patternId = p.getProperty("patternId", "").toString();
                notesByPattern[patternId] = juce::Array<juce::var>(*p.getProperty("notes", juce::Array<juce::var>()).getArray());
            }
        }

        juce::ScopedLock sl(audioLock);
        scheduled.clear();

        if (auto* arr = arrangement.getArray()) {
            for (const auto& c : *arr) {
                auto patternId = c.getProperty("patternId", "").toString();
                auto it = notesByPattern.find(patternId);
                if (it == notesByPattern.end()) continue;

                const auto clipStartPpq = static_cast<double>(c.getProperty("startPpq", 0.0));
                for (const auto& n : it->second) {
                    const auto nStart = clipStartPpq + static_cast<double>(n.getProperty("startPpq", 0.0));
                    const auto nLen = static_cast<double>(n.getProperty("lenPpq", ppqResolution / 4.0));
                    ScheduledNote ev;
                    ev.note = static_cast<int>(n.getProperty("note", 60));
                    ev.vel = static_cast<float>(n.getProperty("vel", 0.8));
                    ev.startSample = ppqToSamples(nStart / ppqResolution);
                    ev.endSample = ppqToSamples((nStart + nLen) / ppqResolution);
                    scheduled.push_back(ev);
                }
            }
        }

        std::sort(scheduled.begin(), scheduled.end(), [](const ScheduledNote& a, const ScheduledNote& b) {
            return a.startSample < b.startSample;
        });
    }

    juce::var helloData() {
        juce::DynamicObject::Ptr cap = new juce::DynamicObject();
        cap->setProperty("webaudioFallback", true);
        cap->setProperty("projectSync", true);
        cap->setProperty("sampler", true);
        cap->setProperty("vst3", false);
        cap->setProperty("audioInput", false);

        juce::DynamicObject::Ptr d = new juce::DynamicObject();
        d->setProperty("protocol", "SLS-IPC/1.0");
        d->setProperty("engineName", "sls-audio-engine");
        d->setProperty("engineVersion", "0.2.0");
        d->setProperty("platform", juce::SystemStats::getOperatingSystemName());
        d->setProperty("pid", juce::Process::getCurrentProcessID());
        d->setProperty("capabilities", juce::var(cap.get()));
        return juce::var(d.get());
    }

    juce::var engineState() {
        juce::DynamicObject::Ptr d = new juce::DynamicObject();
        d->setProperty("ready", ready);
        d->setProperty("sampleRate", sampleRate);
        d->setProperty("bufferSize", bufferSize);
        d->setProperty("cpuLoad", deviceManager.getCpuUsage());
        d->setProperty("xruns", 0);
        d->setProperty("backend", "juce");
        d->setProperty("loadedSamples", static_cast<int>(sampleCache.size()));
        return juce::var(d.get());
    }

    juce::var transportState() {
        juce::DynamicObject::Ptr d = new juce::DynamicObject();
        d->setProperty("playing", playing);
        d->setProperty("bpm", bpm);
        d->setProperty("ppq", (samplePos / sampleRate) * (bpm / 60.0));
        d->setProperty("samplePos", samplePos);
        return juce::var(d.get());
    }

    void resOk(const juce::String& op, const juce::String& id, const juce::var& data) {
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("v", 1);
        obj->setProperty("type", "res");
        obj->setProperty("op", op);
        obj->setProperty("id", id);
        obj->setProperty("ts", nowMs());
        obj->setProperty("ok", true);
        obj->setProperty("data", data.isVoid() ? juce::var(juce::DynamicObject::Ptr(new juce::DynamicObject()).get()) : data);
        emit(obj.get());
    }

    void resErr(const juce::String& op, const juce::String& id, const juce::String& code, const juce::String& message) {
        juce::DynamicObject::Ptr err = new juce::DynamicObject();
        err->setProperty("code", code);
        err->setProperty("message", message);
        err->setProperty("details", juce::var(juce::DynamicObject::Ptr(new juce::DynamicObject()).get()));

        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("v", 1);
        obj->setProperty("type", "res");
        obj->setProperty("op", op);
        obj->setProperty("id", id);
        obj->setProperty("ts", nowMs());
        obj->setProperty("ok", false);
        obj->setProperty("err", juce::var(err.get()));
        emit(obj.get());
    }

    void emitError(const juce::String& code, const juce::String& message) {
        juce::DynamicObject::Ptr data = new juce::DynamicObject();
        data->setProperty("code", code);
        data->setProperty("message", message);
        data->setProperty("details", juce::var(juce::DynamicObject::Ptr(new juce::DynamicObject()).get()));
        emitEvt("error.raised", data.get());
    }

    void transportEvt() { emitEvt("transport.state", transportState()); }

    void emitEvt(const juce::String& op, const juce::var& data) {
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("v", 1);
        obj->setProperty("type", "evt");
        obj->setProperty("op", op);
        obj->setProperty("id", "evt-" + juce::String(nowMs()));
        obj->setProperty("ts", nowMs());
        obj->setProperty("data", data.isVoid() ? juce::var(juce::DynamicObject::Ptr(new juce::DynamicObject()).get()) : data);
        emit(obj.get());
    }

    void emit(juce::DynamicObject* obj) {
        std::lock_guard<std::mutex> lock(ioMutex);
        std::cout << juce::JSON::toString(juce::var(obj), false).toStdString() << "\n";
        std::cout.flush();
    }

    std::mutex ioMutex;
};

} // namespace

int main() {
    juce::ScopedJuceInitialiser_GUI juceInit;

    Engine engine;
    engine.setupAudio();

    std::thread evtThread([&engine]() { engine.pumpStateEvents(); });

    std::string line;
    while (engine.isRunning() && std::getline(std::cin, line)) {
        if (line.empty()) continue;

        auto parsed = juce::JSON::parse(line);
        if (parsed.isVoid()) {
            juce::DynamicObject::Ptr e = new juce::DynamicObject();
            e->setProperty("v", 1);
            e->setProperty("type", "evt");
            e->setProperty("op", "error.raised");
            e->setProperty("id", "evt-parse");
            e->setProperty("ts", nowMs());
            juce::DynamicObject::Ptr data = new juce::DynamicObject();
            data->setProperty("code", "E_BAD_JSON");
            data->setProperty("message", "Invalid JSON line");
            data->setProperty("details", juce::var(juce::DynamicObject::Ptr(new juce::DynamicObject()).get()));
            e->setProperty("data", juce::var(data.get()));
            std::cout << juce::JSON::toString(juce::var(e.get()), false).toStdString() << "\n";
            std::cout.flush();
            continue;
        }

        engine.handle(parsed);
    }

    engine.shutdownAudio();
    if (evtThread.joinable()) evtThread.join();
    return 0;
}
