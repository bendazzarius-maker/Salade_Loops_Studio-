#pragma once

#include "FmInstrumentBase.h"

namespace sls::engine {

class RhodesFmInstrument final : public FmInstrumentBase {
public:
    const char* typeId() const noexcept override { return "rhodes_fm"; }
    fm::FmPatch makePatch() const override;
};

} // namespace sls::engine
