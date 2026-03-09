#include "instruments/FmLeadInstrument.h"
namespace sls::engine {
fm::FmPatch FmLeadInstrument::makePatch() const {
    fm::FmPatch patch;
    patch.name = "FM Lead";
    patch.voice.algorithm = 1;
    patch.voice.masterGain = 0.20f;
    patch.voice.stereoWidth = 0.12f;
    patch.voice.lfoRateHz = 0.0f;
    patch.voice.lfoDepth = 0.0f;
    patch.operators[0] = { 1.0, 0.0, 1.00f, 0.75f, 0.06f, false, 440.0 };
    patch.operators[1] = { 1.0, 0.15, 0.52f, 0.65f, 0.28f, false, 440.0 };
    patch.operators[2] = { 2.0, 0.0, 0.46f, 0.54f, 0.00f, false, 440.0 };
    patch.operators[3] = { 3.0, 0.0, 0.26f, 0.40f, 0.00f, false, 440.0 };
    patch.operators[4] = { 0.5, 0.0, 0.18f, 0.26f, 0.00f, false, 440.0 };
    patch.operators[5] = { 6.0, 0.0, 0.10f, 0.22f, 0.00f, false, 440.0 };
    patch.attack  = { 0.003, 0.002, 0.003, 0.004, 0.004, 0.002 };
    patch.decay   = { 0.180, 0.100, 0.160, 0.140, 0.110, 0.090 };
    patch.sustain = { 0.68f, 0.10f, 0.06f, 0.04f, 0.00f, 0.00f };
    patch.release = { 0.180, 0.100, 0.120, 0.110, 0.080, 0.070 };
    return patch;
}
} // namespace sls::engine
