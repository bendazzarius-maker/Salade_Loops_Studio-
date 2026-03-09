#include "instruments/InstrumentRegistry.h"

namespace sls::inst {

std::unique_ptr<InstrumentBase> InstrumentRegistry::createOrFallback(const juce::String& type) {
    return InstrumentFactory::create(type);
}

InstrumentState InstrumentRegistry::defaultsForType(const juce::String& type) const {
    return createOrFallback(type)->makeDefaultState();
}

void InstrumentRegistry::applyParams(InstrumentState& state, const juce::NamedValueSet& params) const {
    createOrFallback(state.type)->applyParams(state, params);
}

void InstrumentRegistry::configureVoice(VoiceState& voice, const InstrumentState& state, int note, float velocity, double sampleRate) const {
    createOrFallback(state.type)->configureVoice(voice, state, note, velocity, sampleRate);
}

} // namespace sls::inst
