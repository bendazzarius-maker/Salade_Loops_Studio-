#include "instruments/FmGrandPianoInstrument.h"

namespace sls::engine {

fm::FmPatch FmGrandPianoInstrument::makePatch() const {
    fm::FmPatch patch;
    patch.name = "FM Grand Piano";
    patch.voice.algorithm = 0;
    patch.voice.masterGain = 0.20f;
    patch.voice.stereoWidth = 0.12f;
    patch.voice.lfoRateHz = 0.0f;
    patch.voice.lfoDepth = 0.0f;

    patch.operators[0] = { 1.0, 0.0, 1.00f, 0.70f, 0.04f, false, 440.0 };
    patch.operators[1] = { 2.0, 0.2, 0.85f, 0.65f, 0.18f, false, 440.0 };
    patch.operators[2] = { 3.0, 0.0, 0.55f, 0.50f, 0.0f, false, 440.0 };
    patch.operators[3] = { 7.0, 0.1, 0.26f, 0.40f, 0.0f, false, 440.0 };
    patch.operators[4] = { 11.0, 0.0, 0.12f, 0.20f, 0.0f, false, 440.0 };
    patch.operators[5] = { 14.0, 0.0, 0.06f, 0.15f, 0.0f, false, 440.0 };

    patch.attack  = { 0.002, 0.001, 0.001, 0.001, 0.002, 0.001 };
    patch.decay   = { 1.400, 0.120, 0.140, 0.090, 0.040, 0.030 };
    patch.sustain = { 0.00f, 0.00f, 0.00f, 0.00f, 0.00f, 0.00f };
    patch.release = { 0.320, 0.100, 0.080, 0.070, 0.050, 0.040 };
    return patch;
}

} // namespace sls::engine
