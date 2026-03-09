#pragma once

#include "InstrumentFactory.h"

namespace sls::inst {

class InstrumentRegistry {
public:
    InstrumentRegistry() = default;

    InstrumentState defaultsForType(const juce::String& type) const;
    void applyParams(InstrumentState& state, const juce::NamedValueSet& params) const;
    void configureVoice(VoiceState& voice, const InstrumentState& state, int note, float velocity, double sampleRate) const;

private:
    static std::unique_ptr<InstrumentBase> createOrFallback(const juce::String& type);
};

} // namespace sls::inst
