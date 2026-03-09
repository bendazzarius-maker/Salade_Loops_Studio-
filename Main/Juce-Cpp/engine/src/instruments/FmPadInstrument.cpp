#include "instruments/FmPadInstrument.h"
namespace sls::engine {
fm::FmPatch FmPadInstrument::makePatch() const {
    fm::FmPatch patch;
    patch.name = "FM Pad";
    patch.voice.algorithm = 1;
    patch.voice.masterGain = 0.16f;
    patch.voice.stereoWidth = 0.35f;
    patch.voice.lfoRateHz = 0.18f;
    patch.voice.lfoDepth = 0.015f;
    patch.operators[0] = { 1.0, 0.0, 0.95f, 0.55f, 0.00f, false, 440.0 };
    patch.operators[1] = { 2.0, 0.0, 0.24f, 0.42f, 0.00f, false, 440.0 };
    patch.operators[2] = { 1.0, 0.1, 0.55f, 0.50f, 0.00f, false, 440.0 };
    patch.operators[3] = { 0.5, 0.0, 0.22f, 0.34f, 0.00f, false, 440.0 };
    patch.operators[4] = { 3.0, 0.0, 0.18f, 0.25f, 0.00f, false, 440.0 };
    patch.operators[5] = { 5.0, 0.0, 0.08f, 0.18f, 0.00f, false, 440.0 };
    patch.attack  = { 0.120, 0.080, 0.140, 0.100, 0.160, 0.120 };
    patch.decay   = { 0.800, 0.600, 0.900, 0.700, 1.200, 1.000 };
    patch.sustain = { 0.78f, 0.10f, 0.24f, 0.08f, 0.08f, 0.00f };
    patch.release = { 1.200, 0.800, 1.400, 1.000, 1.800, 1.200 };
    return patch;
}
} // namespace sls::engine
