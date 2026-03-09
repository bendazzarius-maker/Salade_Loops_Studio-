#include "instruments/DxPianoInstrument.h"

namespace sls::engine {

fm::FmPatch DxPianoInstrument::makePatch() const {
    fm::FmPatch patch;
    patch.name = "DX Piano";
    patch.voice.algorithm = 1; // electric piano style carrier layout
    patch.voice.masterGain = 0.22f;
    patch.voice.stereoWidth = 0.18f;
    patch.voice.lfoRateHz = 5.2f;
    patch.voice.lfoDepth = 0.015f;

    patch.operators[0] = { 1.0, 0.0, 1.00f, 0.65f, 0.0f, false, 440.0 };
    patch.operators[1] = { 14.0, 0.2, 0.65f, 0.70f, 0.08f, false, 440.0 };
    patch.operators[2] = { 1.0, 0.0, 0.70f, 0.50f, 0.0f, false, 440.0 };
    patch.operators[3] = { 3.0, 0.0, 0.42f, 0.50f, 0.00f, false, 440.0 };
    patch.operators[4] = { 1.0, 0.0, 0.25f, 0.35f, 0.0f, false, 440.0 };
    patch.operators[5] = { 7.0, 0.0, 0.20f, 0.25f, 0.0f, false, 440.0 };

    patch.attack  = { 0.002, 0.001, 0.004, 0.001, 0.010, 0.002 };
    patch.decay   = { 0.900, 0.180, 0.600, 0.140, 1.400, 0.250 };
    patch.sustain = { 0.00f, 0.00f, 0.20f, 0.00f, 0.00f, 0.00f };
    patch.release = { 0.280, 0.080, 0.220, 0.100, 0.300, 0.120 };
    return patch;
}

} // namespace sls::engine
