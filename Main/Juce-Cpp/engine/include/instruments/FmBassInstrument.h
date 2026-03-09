#pragma once

#include "FmInstrumentBase.h"

namespace sls::engine {

class FmBassInstrument final : public FmInstrumentBase {
public:
    const char* typeId() const noexcept override { return "fm_bass"; }
    fm::FmPatch makePatch() const override;
};

} // namespace sls::engine
