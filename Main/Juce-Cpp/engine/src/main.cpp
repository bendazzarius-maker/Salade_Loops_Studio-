#include <atomic>
#include <cmath>
#include <iostream>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <vector>

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_core/juce_core.h>

namespace {
constexpr double kTwoPi = 6.283185307179586;

juce::int64 nowMs() { return juce::Time::currentTimeMillis(); }

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

class Engine : public juce::AudioIODeviceCallback {
public:
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
            float out = 0.0f;
            for (auto& v : voices) {
                if (!v.active) continue;
                out += std::sin(v.phase) * v.velocity * 0.15f;
                v.phase += v.phaseInc;
                if (v.phase > kTwoPi) v.phase -= kTwoPi;
            }
            for (int ch = 0; ch < numOutputChannels; ++ch) {
                if (outputChannelData[ch] != nullptr) outputChannelData[ch][i] = out;
            }
        }

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
    juce::CriticalSection audioLock;
    std::vector<Voice> voices;
    std::vector<ScheduledNote> scheduled;

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
                notesByPattern[patternId] = juce::Array<juce::var>(*p.getProperty("notes", juce::Array<juce::var>() ).getArray());
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
        cap->setProperty("vst3", false);
        cap->setProperty("audioInput", false);

        juce::DynamicObject::Ptr d = new juce::DynamicObject();
        d->setProperty("protocol", "SLS-IPC/1.0");
        d->setProperty("engineName", "sls-audio-engine");
        d->setProperty("engineVersion", "0.1.0");
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
