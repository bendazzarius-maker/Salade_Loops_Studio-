#pragma once

#include "InstrumentTypes.h"

namespace sls::inst {

class InstrumentBase {
public:
    virtual ~InstrumentBase() = default;

    virtual juce::String type() const = 0;
    virtual InstrumentState makeDefaultState() const = 0;

    virtual void applyParams(InstrumentState& state, const juce::NamedValueSet& params) const;
    virtual void configureVoice(VoiceState& voice, const InstrumentState& state, int note, float velocity, double sampleRate) const;
};

} // namespace sls::inst
