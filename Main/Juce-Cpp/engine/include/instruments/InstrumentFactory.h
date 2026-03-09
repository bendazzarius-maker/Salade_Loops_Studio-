#pragma once

#include "InstrumentBase.h"

namespace sls::inst {

class InstrumentFactory {
public:
    static std::unique_ptr<InstrumentBase> create(const juce::String& type);
};

} // namespace sls::inst
