#pragma once
#include "FmInstrumentBase.h"
namespace sls::engine {
class FmSubBassInstrument final : public FmInstrumentBase {
public:
    const char* typeId() const noexcept override { return "fm_subbass"; }
    fm::FmPatch makePatch() const override;
};
} // namespace sls::engine
