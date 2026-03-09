#include "instruments/RhodesFmInstrument.h"

namespace sls::engine {

fm::FmPatch RhodesFmInstrument::makePatch() const {
    fm::FmPatch patch;
    patch.name = "Rhodes FM";
    patch.voice.algorithm = 1;
    patch.voice.masterGain = 0.24f;
    patch.voice.stereoWidth = 0.26f;
    patch.voice.lfoRateHz = 4.6f;
    patch.voice.lfoDepth = 0.028f;

    patch.operators[0] = { 1.0, 0.0, 0.95f, 0.60f, 0.0f, false, 440.0 };
    patch.operators[1] = { 2.0, 0.0, 0.34f, 0.75f, 0.06f, false, 440.0 };
    patch.operators[2] = { 1.0, 0.0, 0.55f, 0.45f, 0.0f, false, 440.0 };
    patch.operators[3] = { 7.0, 0.0, 0.18f, 0.30f, 0.0f, false, 440.0 };
    patch.operators[4] = { 1.0, 0.0, 0.16f, 0.15f, 0.0f, false, 440.0 };
    patch.operators[5] = { 0.5, 0.0, 0.10f, 0.10f, 0.0f, false, 440.0 };

    patch.attack  = { 0.006, 0.002, 0.012, 0.001, 0.025, 0.020 };
    patch.decay   = { 1.300, 0.220, 1.100, 0.120, 1.800, 1.500 };
    patch.sustain = { 0.12f, 0.00f, 0.26f, 0.00f, 0.18f, 0.12f };
    patch.release = { 0.380, 0.100, 0.520, 0.120, 0.700, 0.650 };
    return patch;
}

} // namespace sls::engine
