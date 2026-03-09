#include "instruments/InstrumentBase.h"

#include <cmath>

namespace sls::inst {

namespace {
static float getFloat(const juce::NamedValueSet& params, const juce::String& key, float fallback) {
    const auto v = params.getVarPointer(key);
    if (!v) return fallback;
    if (v->isInt() || v->isDouble() || v->isBool()) return static_cast<float>(double(*v));
    return fallback;
}
}

void InstrumentBase::applyParams(InstrumentState& state, const juce::NamedValueSet& params) const {
    state.gain = std::max(0.0f, getFloat(params, "gain", state.gain));
    state.attack = std::max(0.0005f, getFloat(params, "attack", state.attack));
    state.decay = std::max(0.001f, getFloat(params, "decay", state.decay));
    state.sustain = juce::jlimit(0.0f, 1.0f, getFloat(params, "sustain", state.sustain));
    state.release = std::max(0.005f, getFloat(params, "release", state.release));
    state.fm = getFloat(params, "fm", state.fm);
    state.waveform = static_cast<int>(std::round(getFloat(params, "waveform", static_cast<float>(state.waveform))));
    state.polyphony = std::max(1, static_cast<int>(std::round(getFloat(params, "poly", static_cast<float>(state.polyphony)))));
    state.cutoffHz = std::max(20.0f, getFloat(params, "cutoff", getFloat(params, "tone", state.cutoffHz)));
    state.resonance = std::max(0.1f, getFloat(params, "reso", state.resonance));
    state.detuneCents = getFloat(params, "detune", state.detuneCents);
    state.vibratoRateHz = std::max(0.0f, getFloat(params, "vibratoRate", getFloat(params, "lfoRate", getFloat(params, "tremRate", state.vibratoRateHz))));
    state.vibratoDepthCents = std::max(0.0f, getFloat(params, "vibratoDepth", getFloat(params, "lfoDepth", getFloat(params, "tremDepth", state.vibratoDepthCents))));
    state.drive = std::max(0.0f, getFloat(params, "drive", state.drive));
    state.subLevel = juce::jlimit(0.0f, 1.0f, getFloat(params, "subLevel", state.subLevel));

    for (const auto& nv : params) {
        state.extra.set(nv.name, nv.value);
    }
}

void InstrumentBase::configureVoice(VoiceState& voice, const InstrumentState& state, int note, float velocity, double sampleRate) const {
    voice.instId = state.type;
    voice.note = note;
    voice.velocity = juce::jlimit(0.0f, 1.0f, velocity);
    voice.gain = state.gain;
    voice.attack = state.attack;
    voice.decay = state.decay;
    voice.sustain = state.sustain;
    voice.release = state.release;
    voice.waveform = state.waveform;
    voice.fm = state.fm;
    voice.filterCutoffHz = state.cutoffHz;
    voice.filterResonance = state.resonance;
    voice.detuneCents = state.detuneCents;
    const double hz = 440.0 * std::pow(2.0, (note - 69) / 12.0);
    voice.phaseInc = juce::MathConstants<double>::twoPi * hz / std::max(1.0, sampleRate);
}

} // namespace sls::inst
