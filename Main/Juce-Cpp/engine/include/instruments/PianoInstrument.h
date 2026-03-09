#pragma once
#include "InstrumentBase.h"
namespace sls::inst {
class PianoInstrument final : public InstrumentBase {
public:
    juce::String type() const override { return "piano"; }
    InstrumentState makeDefaultState() const override;
};
} // namespace sls::inst
