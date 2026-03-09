#pragma once

#include "FmInstrumentBase.h"

namespace sls::engine {

class DxPianoInstrument final : public FmInstrumentBase {
public:
    const char* typeId() const noexcept override { return "dx_piano"; }
    fm::FmPatch makePatch() const override;
};

} // namespace sls::engine
