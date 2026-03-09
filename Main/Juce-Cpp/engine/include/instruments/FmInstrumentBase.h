#pragma once

#include <string>
#include "instruments/fm/FmPatch.h"

namespace sls::engine {

class FmInstrumentBase {
public:
    virtual ~FmInstrumentBase() = default;
    virtual const char* typeId() const noexcept = 0;
    virtual fm::FmPatch makePatch() const = 0;
};

} // namespace sls::engine
