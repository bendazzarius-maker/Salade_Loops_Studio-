#include "instruments/FmViolinInstrument.h"

namespace sls::engine {

fm::FmPatch FmViolinInstrument::makePatch() const {
    fm::FmPatch patch;
    patch.name = "FM Violin";
    patch.voice.algorithm = 1;
    patch.voice.masterGain = 0.18f;
    patch.voice.stereoWidth = 0.20f;
    patch.voice.lfoRateHz = 5.3f;
    patch.voice.lfoDepth = 0.010f;

    patch.operators[0] = { 1.0, 0.0, 1.00f, 0.70f, 0.02f, false, 440.0 };
    patch.operators[1] = { 1.0, 0.2, 0.58f, 0.60f, 0.10f, false, 440.0 };
    patch.operators[2] = { 2.0, 0.0, 0.48f, 0.42f, 0.00f, false, 440.0 };
    patch.operators[3] = { 3.0, 0.0, 0.26f, 0.38f, 0.00f, false, 440.0 };
    patch.operators[4] = { 1.0, 0.3, 0.20f, 0.30f, 0.00f, false, 440.0 };
    patch.operators[5] = { 6.0, 0.0, 0.08f, 0.25f, 0.00f, false, 440.0 };

    patch.attack  = { 0.035, 0.020, 0.020, 0.030, 0.050, 0.010 };
    patch.decay   = { 0.180, 0.220, 0.240, 0.260, 0.350, 0.120 };
    patch.sustain = { 0.82f, 0.18f, 0.10f, 0.12f, 0.10f, 0.00f };
    patch.release = { 0.280, 0.180, 0.200, 0.220, 0.240, 0.120 };
    return patch;
}

} // namespace sls::engine
