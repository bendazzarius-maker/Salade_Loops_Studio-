#pragma once
#include "InstrumentBase.h"
namespace sls::inst {
class PadInstrument final : public InstrumentBase {
public:
    juce::String type() const override { return "pad"; }
    InstrumentState makeDefaultState() const override;
};
} // namespace sls::inst
