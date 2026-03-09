#include "instruments/FmBassInstrument.h"

namespace sls::engine {

fm::FmPatch FmBassInstrument::makePatch() const {
    fm::FmPatch patch;
    patch.name = "FM Bass";
    patch.voice.algorithm = 2;
    patch.voice.masterGain = 0.24f;
    patch.voice.stereoWidth = 0.05f;
    patch.voice.lfoRateHz = 0.0f;
    patch.voice.lfoDepth = 0.0f;

    patch.operators[0] = { 1.0, 0.0, 1.00f, 0.60f, 0.12f, false, 440.0 };
    patch.operators[1] = { 1.0, 0.0, 1.10f, 0.72f, 0.18f, false, 440.0 };
    patch.operators[2] = { 0.5, 0.0, 0.40f, 0.45f, 0.00f, false, 440.0 };
    patch.operators[3] = { 0.5, 0.0, 0.48f, 0.30f, 0.00f, false, 440.0 };
    patch.operators[4] = { 1.0, 0.0, 0.26f, 0.24f, 0.00f, false, 440.0 };
    patch.operators[5] = { 2.0, 0.0, 0.08f, 0.20f, 0.00f, false, 440.0 };

    patch.attack  = { 0.002, 0.002, 0.004, 0.005, 0.010, 0.008 };
    patch.decay   = { 0.120, 0.080, 0.180, 0.150, 0.250, 0.140 };
    patch.sustain = { 0.70f, 0.00f, 0.00f, 0.18f, 0.00f, 0.00f };
    patch.release = { 0.160, 0.090, 0.090, 0.160, 0.120, 0.080 };
    return patch;
}

} // namespace sls::engine
