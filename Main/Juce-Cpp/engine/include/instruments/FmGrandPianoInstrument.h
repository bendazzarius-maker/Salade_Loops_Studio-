#pragma once

#include "FmInstrumentBase.h"

namespace sls::engine {

class FmGrandPianoInstrument final : public FmInstrumentBase {
public:
    const char* typeId() const noexcept override { return "fm_grand_piano"; }
    fm::FmPatch makePatch() const override;
};

} // namespace sls::engine
