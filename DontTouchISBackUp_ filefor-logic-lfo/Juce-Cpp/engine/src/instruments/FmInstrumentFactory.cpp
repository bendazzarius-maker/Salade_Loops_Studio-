#include "instruments/FmInstrumentFactory.h"
#include "instruments/DxPianoInstrument.h"
#include "instruments/RhodesFmInstrument.h"
#include "instruments/FmBassInstrument.h"
#include "instruments/FmDrumInstrument.h"
#include "instruments/FmGrandPianoInstrument.h"
#include "instruments/FmViolinInstrument.h"
#include "instruments/FmLeadInstrument.h"
#include "instruments/FmPadInstrument.h"
#include "instruments/FmSubBassInstrument.h"

namespace sls::engine {

std::unique_ptr<FmInstrumentBase> FmInstrumentFactory::create(const std::string& typeId) {
    if (typeId == "dx_piano" || typeId == "dx7_piano" || typeId == "epiano" || typeId == "e_piano" || typeId == "e piano") return std::make_unique<DxPianoInstrument>();
    if (typeId == "rhodes_fm" || typeId == "fender_rhodes" || typeId == "rhodes") return std::make_unique<RhodesFmInstrument>();
    if (typeId == "fm_bass" || typeId == "bass") return std::make_unique<FmBassInstrument>();
    if (typeId == "fm_drums" || typeId == "drums" || typeId == "drum") return std::make_unique<FmDrumInstrument>();
    if (typeId == "fm_grand_piano" || typeId == "grand_piano" || typeId == "grand piano" || typeId == "piano") return std::make_unique<FmGrandPianoInstrument>();
    if (typeId == "fm_violin" || typeId == "violin") return std::make_unique<FmViolinInstrument>();
    if (typeId == "fm_lead" || typeId == "lead") return std::make_unique<FmLeadInstrument>();
    if (typeId == "fm_pad" || typeId == "pad") return std::make_unique<FmPadInstrument>();
    if (typeId == "fm_subbass" || typeId == "sub bass" || typeId == "subbass") return std::make_unique<FmSubBassInstrument>();
    return {};
}

} // namespace sls::engine
