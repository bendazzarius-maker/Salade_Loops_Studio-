#include "instruments/FmSubBassInstrument.h"
namespace sls::engine {
fm::FmPatch FmSubBassInstrument::makePatch() const {
    fm::FmPatch patch;
    patch.name = "FM Sub Bass";
    patch.voice.algorithm = 2;
    patch.voice.masterGain = 0.24f;
    patch.voice.stereoWidth = 0.0f;
    patch.voice.lfoRateHz = 0.0f;
    patch.voice.lfoDepth = 0.0f;
    patch.operators[0] = { 0.5, 0.0, 1.00f, 0.65f, 0.02f, false, 440.0 };
    patch.operators[1] = { 1.0, 0.0, 0.46f, 0.55f, 0.18f, false, 440.0 };
    patch.operators[2] = { 0.5, 0.0, 0.28f, 0.40f, 0.00f, false, 440.0 };
    patch.operators[3] = { 1.0, 0.0, 0.18f, 0.28f, 0.00f, false, 440.0 };
    patch.operators[4] = { 2.0, 0.0, 0.08f, 0.20f, 0.00f, false, 440.0 };
    patch.operators[5] = { 4.0, 0.0, 0.04f, 0.15f, 0.00f, false, 440.0 };
    patch.attack  = { 0.002, 0.002, 0.003, 0.003, 0.004, 0.004 };
    patch.decay   = { 0.100, 0.070, 0.100, 0.090, 0.120, 0.110 };
    patch.sustain = { 0.78f, 0.00f, 0.12f, 0.05f, 0.00f, 0.00f };
    patch.release = { 0.140, 0.090, 0.120, 0.110, 0.080, 0.070 };
    return patch;
}
} // namespace sls::engine
