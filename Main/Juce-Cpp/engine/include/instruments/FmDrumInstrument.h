#pragma once

#include "FmInstrumentBase.h"
#include "instruments/InstrumentTypes.h"

namespace sls::engine {

class FmDrumInstrument final : public FmInstrumentBase {
public:
    const char* typeId() const noexcept override { return "fm_drums"; }
    fm::FmPatch makePatch() const override;
    fm::FmPatch makePatchForPiece(const sls::inst::DrumPieceSpec& piece) const;
};

} // namespace sls::engine
