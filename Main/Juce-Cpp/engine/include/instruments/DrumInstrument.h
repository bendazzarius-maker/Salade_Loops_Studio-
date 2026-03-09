#pragma once

#include "InstrumentBase.h"

namespace sls::inst {

class DrumInstrument final : public InstrumentBase {
public:
    juce::String type() const override { return "drums"; }
    InstrumentState makeDefaultState() const override;
    void applyParams(InstrumentState& state, const juce::NamedValueSet& params) const override;
};

} // namespace sls::inst
