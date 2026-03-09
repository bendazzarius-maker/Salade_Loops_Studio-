#pragma once

#include "FmInstrumentBase.h"

namespace sls::engine {

class FmViolinInstrument final : public FmInstrumentBase {
public:
    const char* typeId() const noexcept override { return "fm_violin"; }
    fm::FmPatch makePatch() const override;
};

} // namespace sls::engine
