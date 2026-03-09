#include "instruments/InstrumentFactory.h"
#include "instruments/BassInstrument.h"
#include "instruments/DrumInstrument.h"
#include "instruments/LeadInstrument.h"
#include "instruments/PadInstrument.h"
#include "instruments/PianoInstrument.h"
#include "instruments/SubBassInstrument.h"
#include "instruments/ViolinInstrument.h"

namespace sls::inst {

std::unique_ptr<InstrumentBase> InstrumentFactory::create(const juce::String& rawType) {
    const auto type = rawType.trim().toLowerCase();
    if (type == "piano" || type == "grand piano" || type == "fender rhodes" || type == "e piano") return std::make_unique<PianoInstrument>();
    if (type == "bass") return std::make_unique<BassInstrument>();
    if (type == "lead") return std::make_unique<LeadInstrument>();
    if (type == "pad") return std::make_unique<PadInstrument>();
    if (type == "sub bass" || type == "subbass") return std::make_unique<SubBassInstrument>();
    if (type == "violin") return std::make_unique<ViolinInstrument>();
    if (type == "drums" || type == "drum") return std::make_unique<DrumInstrument>();
    return std::make_unique<PianoInstrument>();
}

} // namespace sls::inst
