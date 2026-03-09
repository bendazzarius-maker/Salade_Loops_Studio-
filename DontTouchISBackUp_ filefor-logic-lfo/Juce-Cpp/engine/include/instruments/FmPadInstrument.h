#pragma once
#include "FmInstrumentBase.h"
namespace sls::engine {
class FmPadInstrument final : public FmInstrumentBase {
public:
    const char* typeId() const noexcept override { return "fm_pad"; }
    fm::FmPatch makePatch() const override;
};
} // namespace sls::engine
