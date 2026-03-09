#pragma once
#include "InstrumentBase.h"
namespace sls::inst {
class BassInstrument final : public InstrumentBase {
public:
    juce::String type() const override { return "bass"; }
    InstrumentState makeDefaultState() const override;
};
} // namespace sls::inst
