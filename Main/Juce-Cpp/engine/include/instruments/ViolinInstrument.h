#pragma once
#include "InstrumentBase.h"
namespace sls::inst {
class ViolinInstrument final : public InstrumentBase {
public:
    juce::String type() const override { return "violin"; }
    InstrumentState makeDefaultState() const override;
};
} // namespace sls::inst
