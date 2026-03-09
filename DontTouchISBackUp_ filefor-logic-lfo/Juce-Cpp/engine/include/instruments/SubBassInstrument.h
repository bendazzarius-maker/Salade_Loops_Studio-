#pragma once
#include "InstrumentBase.h"
namespace sls::inst {
class SubBassInstrument final : public InstrumentBase {
public:
    juce::String type() const override { return "subbass"; }
    InstrumentState makeDefaultState() const override;
};
} // namespace sls::inst
