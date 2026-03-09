#pragma once
#include "InstrumentBase.h"
namespace sls::inst {
class LeadInstrument final : public InstrumentBase {
public:
    juce::String type() const override { return "lead"; }
    InstrumentState makeDefaultState() const override;
};
} // namespace sls::inst
