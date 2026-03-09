#include "instruments/FmDrumInstrument.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace sls::engine {
namespace {

using sls::inst::DrumPieceSpec;
using sls::engine::fm::FmPatch;
using sls::engine::fm::FmOperatorParams;

constexpr float kNormInv = 1.0f / 100.0f;

static float norm100(float v) { return juce::jlimit(0.0f, 1.0f, v * kNormInv); }
static float signedTune(float v) { return juce::jlimit(-1.0f, 1.0f, (v - 50.0f) / 50.0f); }
static float safeLevel(float v) { return juce::jlimit(0.0f, 1.0f, v); }
static int algorithmFromPiece(const DrumPieceSpec& piece, int fallback) {
    if (piece.algorithm <= 0) return fallback;
    return std::max(0, piece.algorithm) % 8;
}
static juce::String styleId(const DrumPieceSpec& piece) {
    if (piece.kitId.isNotEmpty()) return piece.kitId;
    if (piece.presetId.contains(":")) return piece.presetId.upToFirstOccurrenceOf(":", false, false);
    return "globalHybridA";
}
static juce::String pieceKey(const DrumPieceSpec& piece) {
    if (piece.id.isNotEmpty()) return piece.id;
    if (piece.name.isNotEmpty()) return piece.name;
    return piece.displayName;
}
static juce::String lowerPieceKey(const DrumPieceSpec& piece) { return pieceKey(piece).toLowerCase(); }

static void setEnv(FmPatch& p, int op, double a, double d, float s, double r) {
    const auto i = static_cast<std::size_t>(juce::jlimit(0, 5, op));
    p.attack[i] = std::max(0.0005, a);
    p.decay[i] = std::max(0.002, d);
    p.sustain[i] = juce::jlimit(0.0f, 1.0f, s);
    p.release[i] = std::max(0.002, r);
}

static FmOperatorParams makeOp(double ratio, double detuneHz, float level, float vel, float feedback, bool fixed = false, double fixedHz = 440.0) {
    FmOperatorParams op;
    op.ratio = ratio;
    op.detuneHz = detuneHz;
    op.outputLevel = juce::jlimit(0.0f, 1.4f, level);
    op.velocitySensitivity = juce::jlimit(0.0f, 1.0f, vel);
    op.feedback = juce::jlimit(0.0f, 1.0f, feedback);
    op.fixedFrequency = fixed;
    op.fixedFrequencyHz = fixedHz;
    return op;
}

static void initPatchMeta(FmPatch& p, const DrumPieceSpec& piece, int algorithm, float gain) {
    p.name = (piece.displayName.isNotEmpty() ? piece.displayName : pieceKey(piece)).toStdString();
    p.voice.algorithm = juce::jlimit(0, 2, algorithm);
    p.voice.masterGain = juce::jlimit(0.05f, 0.95f, gain * safeLevel(piece.level));
    p.voice.stereoWidth = 0.0f;
    p.voice.lfoRateHz = 0.0f;
    p.voice.lfoDepth = 0.0f;
}

static float driveBoost(const DrumPieceSpec& piece, float amount = 0.45f) {
    return 1.0f + norm100(piece.drive) * amount;
}

static void applyGlobalLiveControls(FmPatch& p, const DrumPieceSpec& piece) {
    const float tune = signedTune(piece.tune);
    const float fb = norm100(piece.feedback);
    const float noiseMix = norm100(piece.noiseMix > 0.0f ? piece.noiseMix : piece.noise * 100.0f);
    const float drive = norm100(piece.drive * 100.0f > 1.0f ? piece.drive : piece.drive * 100.0f); // supports 0..1 or 0..100-ish data
    const float mixX = juce::jlimit(0.0f, 1.0f, piece.operatorMixX);
    const float mixY = juce::jlimit(0.0f, 1.0f, piece.operatorMixY);

    p.voice.masterGain = juce::jlimit(0.04f, 1.60f, p.voice.masterGain * (0.70f + drive * 1.05f));

    // Tune mostly affects carriers / body operators.
    p.operators[0].ratio = std::max(0.08, p.operators[0].ratio * (1.0 + tune * 0.45));
    p.operators[2].ratio = std::max(0.08, p.operators[2].ratio * (1.0 + tune * 0.35));
    p.operators[3].ratio = std::max(0.08, p.operators[3].ratio * (1.0 + tune * 0.28));

    // Feedback/noise live controls.
    p.operators[1].feedback = juce::jlimit(0.0f, 1.0f, p.operators[1].feedback * (0.2f + fb * 2.2f));
    p.operators[3].feedback = juce::jlimit(0.0f, 1.0f, p.operators[3].feedback * (0.2f + fb * 2.0f));
    p.operators[4].feedback = juce::jlimit(0.0f, 1.0f, p.operators[4].feedback * (0.2f + fb * 1.8f));

    p.operators[4].outputLevel = juce::jlimit(0.0f, 1.50f, p.operators[4].outputLevel * (0.2f + noiseMix * 2.3f));
    p.operators[5].outputLevel = juce::jlimit(0.0f, 1.50f, p.operators[5].outputLevel * (0.2f + noiseMix * 2.5f));

    // XY pad drives carrier/modulator balance.
    p.operators[0].outputLevel = juce::jlimit(0.0f, 1.6f, p.operators[0].outputLevel * (0.45f + mixY * 1.2f));
    p.operators[2].outputLevel = juce::jlimit(0.0f, 1.6f, p.operators[2].outputLevel * (0.35f + mixX * 1.4f));
    p.operators[3].outputLevel = juce::jlimit(0.0f, 1.6f, p.operators[3].outputLevel * (0.35f + (1.0f - mixX) * 1.4f));
    p.operators[1].outputLevel = juce::jlimit(0.0f, 1.6f, p.operators[1].outputLevel * (0.35f + (1.0f - mixY) * 1.2f));

    if (piece.operatorsEdited) {
        for (std::size_t i = 0; i < piece.operators.size() && i < p.operators.size(); ++i) {
            const auto& src = piece.operators[i];
            auto& dst = p.operators[i];
            if (!src.enabled) {
                dst.outputLevel = 0.0f;
                continue;
            }
            dst.outputLevel = juce::jlimit(0.0f, 1.6f, norm100(src.level) * 1.5f);
            dst.ratio = std::max(0.08, static_cast<double>(src.ratio));
            dst.detuneHz = (static_cast<double>(src.detune) - 50.0) * 0.18;
            setEnv(p, static_cast<int>(i), 0.0004 + norm100(src.attack) * 0.08, 0.01 + norm100(src.release) * 0.75, 0.0f, 0.004 + norm100(src.release) * 0.45);
        }
    }
}

static FmPatch buildKickSub(const DrumPieceSpec& piece, const juce::String& style) {
    FmPatch p;
    initPatchMeta(p, piece, algorithmFromPiece(piece, 2), style == "trapSub808" ? 0.48f : 0.36f);
    const float sustainMacro = norm100(piece.macros[0]);
    const float glide = norm100(piece.macros[1]);
    const float body = norm100(piece.macros[2]);
    const float transient = norm100(piece.macros[3]);
    const float fb = norm100(piece.feedback);
    const float noise = norm100(piece.noiseMix);

    p.operators[0] = makeOp(0.50 + glide * 0.08, 0.0, 1.0f, 0.15f, 0.05f);
    p.operators[1] = makeOp(1.00 + body * 0.35, 0.0, 0.82f, 0.10f, 0.72f + fb * 0.22f);
    p.operators[2] = makeOp(1.00, 0.0, 0.18f + transient * 0.32f, 0.30f, 0.12f);
    p.operators[3] = makeOp(0.25, 0.0, style == "trapSub808" ? 0.72f : 0.42f, 0.10f, 0.10f);
    p.operators[4] = makeOp(0.50, 0.0, 0.48f, 0.10f, 0.58f + fb * 0.18f);
    p.operators[5] = makeOp(12.0, 0.0, 0.06f + noise * 0.10f + transient * 0.06f, 0.40f, 0.0f, true, 2400.0);

    setEnv(p, 0, 0.0006, style == "trapSub808" ? 0.34 : 0.18, 0.0f, 0.06 + sustainMacro * 0.16);
    setEnv(p, 1, 0.0004, 0.07 + (1.0f - body) * 0.08, 0.0f, 0.01);
    setEnv(p, 2, 0.0004, 0.010 + (1.0f - transient) * 0.02, 0.0f, 0.004);
    setEnv(p, 3, 0.0006, style == "trapSub808" ? 0.50 : 0.22, 0.0f, 0.14 + sustainMacro * 0.30);
    setEnv(p, 4, 0.0004, 0.09 + (1.0f - sustainMacro) * 0.10, 0.0f, 0.02);
    setEnv(p, 5, 0.0002, 0.012, 0.0f, 0.003);

    if (style == "rockMetalKit") {
        p.voice.masterGain *= 0.92f;
        p.operators[2].outputLevel += 0.18f;
        p.operators[5].outputLevel += 0.08f;
        setEnv(p, 0, 0.0006, 0.14, 0.0f, 0.04);
        setEnv(p, 3, 0.0006, 0.12, 0.0f, 0.06);
    } else if (style == "electroFmLab") {
        p.voice.masterGain *= 0.88f;
        p.operators[1].ratio = 1.9;
        p.operators[4].ratio = 0.75;
        p.operators[1].feedback = 0.88f;
    } else if (style == "jazzStudio") {
        p.voice.masterGain *= 0.78f;
        p.operators[3].outputLevel *= 0.35f;
        setEnv(p, 0, 0.0006, 0.10, 0.0f, 0.03);
    }

    applyGlobalLiveControls(p, piece);
    return p;
}

static FmPatch buildKickAcoustic(const DrumPieceSpec& piece, const juce::String& style) {
    FmPatch p;
    initPatchMeta(p, piece, algorithmFromPiece(piece, 2), 0.34f);
    const float beater = norm100(piece.macros[0]);
    const float shell = norm100(piece.macros[1]);
    const float depth = norm100(piece.macros[2]);
    const float punch = norm100(piece.macros[3]);
    const float fb = norm100(piece.feedback);

    p.operators[0] = makeOp(1.0, 0.0, 0.92f, 0.20f, 0.02f);
    p.operators[1] = makeOp(1.6 + shell * 0.35, 0.0, 0.58f, 0.18f, 0.56f + fb * 0.22f);
    p.operators[2] = makeOp(6.0, 0.0, 0.15f + beater * 0.40f, 0.35f, 0.08f);
    p.operators[3] = makeOp(0.50 + depth * 0.10, 0.0, 0.48f + depth * 0.18f, 0.15f, 0.04f);
    p.operators[4] = makeOp(2.2 + shell * 0.20, 0.0, 0.20f + shell * 0.12f, 0.18f, 0.40f);
    p.operators[5] = makeOp(10.0, 0.0, 0.03f + norm100(piece.noiseMix) * 0.08f, 0.40f, 0.00f, true, 3200.0);

    setEnv(p, 0, 0.0007, 0.14 + depth * 0.10, 0.0f, 0.04);
    setEnv(p, 1, 0.0005, 0.06 + punch * 0.04, 0.0f, 0.01);
    setEnv(p, 2, 0.0002, 0.006 + (1.0f - beater) * 0.01, 0.0f, 0.002);
    setEnv(p, 3, 0.0008, 0.18 + depth * 0.14, 0.0f, 0.06);
    setEnv(p, 4, 0.0006, 0.08 + shell * 0.08, 0.0f, 0.02);
    setEnv(p, 5, 0.0002, 0.010, 0.0f, 0.002);

    if (style == "rockMetalKit") {
        p.operators[2].outputLevel += 0.26f;
        p.operators[5].outputLevel += 0.04f;
        p.voice.masterGain *= 1.05f;
    } else if (style == "jazzStudio") {
        p.operators[2].outputLevel *= 0.55f;
        p.voice.masterGain *= 0.82f;
        p.operators[3].outputLevel += 0.08f;
    } else if (style == "electroFmLab") {
        p.operators[1].ratio = 2.4;
        p.operators[4].ratio = 3.5;
        p.operators[4].feedback = 0.58f;
    }

    applyGlobalLiveControls(p, piece);
    return p;
}

static FmPatch buildSnareMain(const DrumPieceSpec& piece, const juce::String& style) {
    FmPatch p;
    initPatchMeta(p, piece, algorithmFromPiece(piece, 1), 0.30f);
    const float crack = norm100(piece.macros[0]);
    const float wires = norm100(piece.macros[1]);
    const float jazzSoft = norm100(piece.macros[2]);
    const float metalSnap = norm100(piece.macros[3]);
    const float noise = norm100(piece.noiseMix);

    p.operators[0] = makeOp(1.8, 0.0, 0.62f, 0.18f, 0.04f);
    p.operators[1] = makeOp(2.5, 0.0, 0.66f + crack * 0.18f, 0.15f, 0.72f);
    p.operators[2] = makeOp(2.7, 0.0, 0.26f + wires * 0.12f, 0.12f, 0.10f);
    p.operators[3] = makeOp(10.5, 0.0, 0.48f + noise * 0.40f + wires * 0.12f, 0.28f, 0.56f, true, 3600.0);
    p.operators[4] = makeOp(16.0, 0.0, 0.24f + metalSnap * 0.20f, 0.28f, 0.20f, true, 6600.0);
    p.operators[5] = makeOp(22.0, 0.0, 0.18f + metalSnap * 0.12f, 0.35f, 0.0f, true, 9200.0);

    setEnv(p, 0, 0.0007, 0.08 + jazzSoft * 0.03, 0.0f, 0.020);
    setEnv(p, 1, 0.0004, 0.022 + crack * 0.020, 0.0f, 0.006);
    setEnv(p, 2, 0.0005, 0.10 + jazzSoft * 0.05, 0.0f, 0.020);
    setEnv(p, 3, 0.0002, 0.16 + wires * 0.08, 0.0f, 0.028);
    setEnv(p, 4, 0.0002, 0.05 + metalSnap * 0.05, 0.0f, 0.010);
    setEnv(p, 5, 0.0002, 0.018, 0.0f, 0.004);

    if (style == "jazzStudio") {
        p.voice.masterGain *= 0.80f;
        p.operators[3].outputLevel *= 0.62f;
        p.operators[0].outputLevel += 0.08f;
    } else if (style == "rockMetalKit") {
        p.voice.masterGain *= 1.06f;
        p.operators[1].outputLevel += 0.20f;
        p.operators[4].outputLevel += 0.16f;
        p.operators[3].outputLevel += 0.10f;
    } else if (style == "trapSub808") {
        p.operators[3].outputLevel += 0.18f;
        p.operators[4].outputLevel += 0.12f;
        p.operators[0].outputLevel *= 0.84f;
    } else if (style == "electroFmLab") {
        p.operators[0].ratio = 2.2;
        p.operators[2].ratio = 4.2;
        p.operators[4].feedback = 0.52f;
    }

    applyGlobalLiveControls(p, piece);
    return p;
}

static FmPatch buildSideSnare(const DrumPieceSpec& piece, const juce::String& style) {
    FmPatch p;
    initPatchMeta(p, piece, algorithmFromPiece(piece, 1), 0.20f);
    const float wood = norm100(piece.macros[0]);
    const float body = norm100(piece.macros[2]);
    p.operators[0] = makeOp(2.2, 0.0, 0.58f + body * 0.10f, 0.18f, 0.02f);
    p.operators[1] = makeOp(4.0 + wood * 1.4, 0.0, 0.72f, 0.12f, 0.54f);
    p.operators[2] = makeOp(7.0, 0.0, 0.18f, 0.20f, 0.10f);
    p.operators[3] = makeOp(14.0, 0.0, 0.08f, 0.20f, 0.0f, true, 2800.0);
    p.operators[4] = makeOp(18.0, 0.0, 0.04f, 0.20f, 0.0f, true, 5400.0);
    p.operators[5] = makeOp(24.0, 0.0, 0.02f, 0.20f, 0.0f, true, 7600.0);
    setEnv(p, 0, 0.0005, 0.030, 0.0f, 0.004);
    setEnv(p, 1, 0.0002, 0.012, 0.0f, 0.002);
    setEnv(p, 2, 0.0002, 0.015, 0.0f, 0.003);
    setEnv(p, 3, 0.0002, 0.010, 0.0f, 0.002);
    setEnv(p, 4, 0.0002, 0.008, 0.0f, 0.002);
    setEnv(p, 5, 0.0002, 0.006, 0.0f, 0.002);
    if (style == "rockMetalKit") p.operators[1].outputLevel += 0.12f;
    applyGlobalLiveControls(p, piece);
    return p;
}

static FmPatch buildClap(const DrumPieceSpec& piece, const juce::String& style) {
    FmPatch p;
    initPatchMeta(p, piece, algorithmFromPiece(piece, 1), 0.24f);
    const float width = norm100(piece.macros[0]);
    const float bursts = norm100(piece.macros[1]);
    const float room = norm100(piece.macros[2]);
    const float edge = norm100(piece.macros[3]);
    p.operators[0] = makeOp(5.0, 0.0, 0.20f, 0.20f, 0.0f, true, 1700.0);
    p.operators[1] = makeOp(10.0, 0.0, 0.58f + width * 0.18f, 0.30f, 0.72f, true, 3200.0);
    p.operators[2] = makeOp(16.0, 0.0, 0.44f + bursts * 0.20f, 0.30f, 0.64f, true, 5100.0);
    p.operators[3] = makeOp(22.0, 0.0, 0.30f + edge * 0.18f, 0.28f, 0.40f, true, 8000.0);
    p.operators[4] = makeOp(1.0, 0.0, 0.14f + room * 0.20f, 0.20f, 0.0f);
    p.operators[5] = makeOp(24.0, 0.0, 0.18f + room * 0.24f, 0.20f, 0.0f, true, 9800.0);
    setEnv(p, 0, 0.0002, 0.012, 0.0f, 0.004);
    setEnv(p, 1, 0.0002, 0.020 + width * 0.02, 0.0f, 0.008);
    setEnv(p, 2, 0.0002, 0.030 + bursts * 0.03, 0.0f, 0.012);
    setEnv(p, 3, 0.0002, 0.040 + edge * 0.02, 0.0f, 0.014);
    setEnv(p, 4, 0.0020, 0.09 + room * 0.08, 0.0f, 0.04);
    setEnv(p, 5, 0.0004, 0.10 + room * 0.06, 0.0f, 0.03);
    if (style == "trapSub808" || style == "electroFmLab") p.voice.masterGain *= 1.05f;
    applyGlobalLiveControls(p, piece);
    return p;
}

static FmPatch buildRimshot(const DrumPieceSpec& piece, const juce::String& style) {
    FmPatch p;
    initPatchMeta(p, piece, algorithmFromPiece(piece, 1), 0.18f);
    const float snap = norm100(piece.macros[3]);
    p.operators[0] = makeOp(2.8, 0.0, 0.54f, 0.18f, 0.02f);
    p.operators[1] = makeOp(7.0, 0.0, 0.82f, 0.12f, 0.68f);
    p.operators[2] = makeOp(12.0, 0.0, 0.16f + snap * 0.12f, 0.18f, 0.12f, true, 2600.0);
    p.operators[3] = makeOp(19.0, 0.0, 0.12f + snap * 0.16f, 0.18f, 0.0f, true, 5200.0);
    p.operators[4] = makeOp(23.0, 0.0, 0.04f, 0.18f, 0.0f, true, 8400.0);
    p.operators[5] = makeOp(1.0, 0.0, 0.04f, 0.18f, 0.0f);
    setEnv(p, 0, 0.0003, 0.018, 0.0f, 0.004);
    setEnv(p, 1, 0.0002, 0.010, 0.0f, 0.002);
    setEnv(p, 2, 0.0002, 0.010, 0.0f, 0.002);
    setEnv(p, 3, 0.0002, 0.016, 0.0f, 0.003);
    setEnv(p, 4, 0.0002, 0.010, 0.0f, 0.002);
    setEnv(p, 5, 0.0003, 0.020, 0.0f, 0.004);
    if (style == "rockMetalKit") p.operators[3].outputLevel += 0.08f;
    applyGlobalLiveControls(p, piece);
    return p;
}

static FmPatch buildHat(const DrumPieceSpec& piece, const juce::String& style, bool open, bool pedal) {
    FmPatch p;
    initPatchMeta(p, piece, algorithmFromPiece(piece, 1), open ? 0.17f : 0.13f);
    const float openness = norm100(piece.macros[0]);
    const float brightness = norm100(piece.macros[1]);
    const float air = norm100(piece.macros[3]);
    const double f1 = open ? 4600.0 : 5300.0;
    const double f2 = open ? 7600.0 : 8900.0;
    const double f3 = open ? 11200.0 : 12800.0;
    p.operators[0] = makeOp(18.0, 0.0, 0.24f + brightness * 0.18f, 0.18f, 0.0f, true, f1);
    p.operators[1] = makeOp(27.0, 0.0, 0.60f + brightness * 0.16f, 0.16f, 0.82f, true, f1 * 1.17);
    p.operators[2] = makeOp(21.0, 0.0, 0.20f + air * 0.18f, 0.18f, 0.0f, true, f2);
    p.operators[3] = makeOp(34.0, 0.0, 0.56f + norm100(piece.feedback) * 0.18f, 0.16f, 0.88f, true, f2 * 1.13);
    p.operators[4] = makeOp(29.0, 0.0, 0.22f + air * 0.20f, 0.16f, 0.10f, true, f3);
    p.operators[5] = makeOp(41.0, 0.0, 0.42f + norm100(piece.noiseMix) * 0.28f, 0.18f, 0.72f, true, f3 * 1.09);
    const double baseDecay = pedal ? 0.020 : (open ? 0.15 + openness * 0.10 : 0.045 + openness * 0.02);
    setEnv(p, 0, 0.0002, baseDecay * 0.35, 0.0f, 0.003);
    setEnv(p, 1, 0.0002, baseDecay * 0.45, 0.0f, 0.004);
    setEnv(p, 2, 0.0002, baseDecay * 0.60, 0.0f, 0.005);
    setEnv(p, 3, 0.0002, baseDecay * 0.70, 0.0f, 0.006);
    setEnv(p, 4, 0.0002, baseDecay * 0.80, 0.0f, 0.007);
    setEnv(p, 5, 0.0002, baseDecay, 0.0f, 0.008);
    if (style == "jazzStudio") {
        p.voice.masterGain *= 0.82f;
        p.operators[5].outputLevel *= 0.8f;
    } else if (style == "rockMetalKit") {
        p.voice.masterGain *= 1.05f;
        p.operators[1].outputLevel += 0.12f;
        p.operators[3].outputLevel += 0.10f;
    } else if (style == "electroFmLab") {
        p.operators[0].fixedFrequencyHz *= 1.08;
        p.operators[2].fixedFrequencyHz *= 1.05;
    }
    applyGlobalLiveControls(p, piece);
    return p;
}

static FmPatch buildTom(const DrumPieceSpec& piece, const juce::String& style, float ratioBase, float ratioSub, float gain) {
    FmPatch p;
    initPatchMeta(p, piece, algorithmFromPiece(piece, 2), gain);
    const float shell = norm100(piece.macros[2]);
    const float attackFocus = norm100(piece.macros[1]);
    p.operators[0] = makeOp(ratioBase, 0.0, 0.86f, 0.15f, 0.04f);
    p.operators[1] = makeOp(ratioBase * (1.6 + shell * 0.25), 0.0, 0.50f, 0.12f, 0.56f);
    p.operators[2] = makeOp(5.0, 0.0, 0.16f + attackFocus * 0.20f, 0.22f, 0.12f);
    p.operators[3] = makeOp(ratioSub, 0.0, 0.42f + shell * 0.10f, 0.14f, 0.04f);
    p.operators[4] = makeOp(ratioSub * 2.1, 0.0, 0.18f + shell * 0.08f, 0.12f, 0.38f);
    p.operators[5] = makeOp(12.0, 0.0, 0.04f, 0.20f, 0.0f, true, 2800.0);
    setEnv(p, 0, 0.0008, 0.15 + shell * 0.06, 0.0f, 0.05);
    setEnv(p, 1, 0.0005, 0.07 + attackFocus * 0.04, 0.0f, 0.02);
    setEnv(p, 2, 0.0003, 0.012, 0.0f, 0.004);
    setEnv(p, 3, 0.0008, 0.18 + shell * 0.10, 0.0f, 0.06);
    setEnv(p, 4, 0.0005, 0.08, 0.0f, 0.02);
    setEnv(p, 5, 0.0002, 0.010, 0.0f, 0.002);
    if (style == "rockMetalKit") p.voice.masterGain *= 1.08f;
    if (style == "jazzStudio") p.voice.masterGain *= 0.84f;
    applyGlobalLiveControls(p, piece);
    return p;
}

static FmPatch buildRideMain(const DrumPieceSpec& piece, const juce::String& style, bool bellOnly) {
    FmPatch p;
    initPatchMeta(p, piece, algorithmFromPiece(piece, 1), bellOnly ? 0.16f : 0.18f);
    const float ping = norm100(piece.macros[0]);
    const float wash = norm100(piece.macros[1]);
    p.operators[0] = makeOp(12.0, 0.0, 0.22f + ping * 0.14f, 0.18f, 0.0f, true, bellOnly ? 2100.0 : 1500.0);
    p.operators[1] = makeOp(18.0, 0.0, 0.58f, 0.16f, 0.78f, true, bellOnly ? 3200.0 : 2400.0);
    p.operators[2] = makeOp(21.0, 0.0, 0.20f + wash * 0.16f, 0.18f, 0.0f, true, 5600.0);
    p.operators[3] = makeOp(31.0, 0.0, 0.56f + wash * 0.18f, 0.16f, 0.80f, true, 7200.0);
    p.operators[4] = makeOp(27.0, 0.0, 0.16f + wash * 0.18f, 0.16f, 0.06f, true, 9800.0);
    p.operators[5] = makeOp(39.0, 0.0, 0.40f + norm100(piece.noiseMix) * 0.22f, 0.16f, 0.68f, true, 12400.0);
    const double d = bellOnly ? 0.38 : 0.62 + wash * 0.30;
    setEnv(p, 0, 0.0002, d * 0.25, 0.0f, 0.010);
    setEnv(p, 1, 0.0002, d * 0.34, 0.0f, 0.012);
    setEnv(p, 2, 0.0002, d * 0.60, 0.0f, 0.016);
    setEnv(p, 3, 0.0002, d * 0.78, 0.0f, 0.020);
    setEnv(p, 4, 0.0002, d * 0.92, 0.0f, 0.026);
    setEnv(p, 5, 0.0002, d, 0.0f, 0.030);
    if (style == "jazzStudio") { p.voice.masterGain *= 0.82f; p.operators[5].outputLevel *= 0.8f; }
    if (style == "rockMetalKit") { p.voice.masterGain *= 1.08f; p.operators[1].outputLevel += 0.10f; p.operators[3].outputLevel += 0.08f; }
    applyGlobalLiveControls(p, piece);
    return p;
}

static FmPatch buildCrashLike(const DrumPieceSpec& piece, const juce::String& style, float brightness, float lengthMul, float aggression) {
    FmPatch p;
    initPatchMeta(p, piece, algorithmFromPiece(piece, 1), 0.18f);
    p.operators[0] = makeOp(18.0, 0.0, 0.20f + brightness * 0.12f, 0.18f, 0.0f, true, 3100.0);
    p.operators[1] = makeOp(29.0, 0.0, 0.62f + aggression * 0.12f, 0.16f, 0.84f, true, 4300.0);
    p.operators[2] = makeOp(26.0, 0.0, 0.22f + brightness * 0.18f, 0.16f, 0.0f, true, 6800.0);
    p.operators[3] = makeOp(37.0, 0.0, 0.60f + aggression * 0.16f, 0.16f, 0.86f, true, 8800.0);
    p.operators[4] = makeOp(34.0, 0.0, 0.24f + norm100(piece.noiseMix) * 0.24f, 0.16f, 0.08f, true, 11200.0);
    p.operators[5] = makeOp(49.0, 0.0, 0.52f + norm100(piece.noiseMix) * 0.20f, 0.16f, 0.76f, true, 13800.0);
    const double d = (0.42 + lengthMul * 0.80);
    setEnv(p, 0, 0.0002, d * 0.25, 0.0f, 0.012);
    setEnv(p, 1, 0.0002, d * 0.40, 0.0f, 0.016);
    setEnv(p, 2, 0.0002, d * 0.55, 0.0f, 0.020);
    setEnv(p, 3, 0.0002, d * 0.74, 0.0f, 0.026);
    setEnv(p, 4, 0.0002, d * 0.88, 0.0f, 0.032);
    setEnv(p, 5, 0.0002, d, 0.0f, 0.036);
    if (style == "jazzStudio") { p.voice.masterGain *= 0.78f; p.operators[5].outputLevel *= 0.75f; }
    if (style == "rockMetalKit") { p.voice.masterGain *= 1.10f; p.operators[1].outputLevel += 0.12f; p.operators[3].outputLevel += 0.12f; }
    if (style == "electroFmLab") { p.operators[0].fixedFrequencyHz *= 1.10; p.operators[2].fixedFrequencyHz *= 1.08; }
    applyGlobalLiveControls(p, piece);
    return p;
}

static FmPatch buildForPiece(const DrumPieceSpec& piece) {
    const auto style = styleId(piece);
    const auto key = lowerPieceKey(piece);
    if (key.contains("kicksub") || key.contains("808") || (piece.family == "kick" && key.contains("sub"))) return buildKickSub(piece, style);
    if (key.contains("kick")) return buildKickAcoustic(piece, style);
    if (key.contains("snaremain") || (piece.family == "snare" && key.contains("snare"))) return buildSnareMain(piece, style);
    if (key.contains("sidesnare") || key.contains("side")) return buildSideSnare(piece, style);
    if (key.contains("clap")) return buildClap(piece, style);
    if (key.contains("rim")) return buildRimshot(piece, style);
    if (key.contains("pedalhat")) return buildHat(piece, style, false, true);
    if (key.contains("hat") || piece.family == "hat") return buildHat(piece, style, key.contains("open"), false);
    if (key.contains("hightom")) return buildTom(piece, style, 1.70f, 0.95f, 0.24f);
    if (key.contains("midtom")) return buildTom(piece, style, 1.15f, 0.62f, 0.28f);
    if (key.contains("lowtom")) return buildTom(piece, style, 0.72f, 0.38f, 0.32f);
    if (key.contains("ridebell")) return buildRideMain(piece, style, true);
    if (key.contains("ride")) return buildRideMain(piece, style, false);
    if (key.contains("splash")) return buildCrashLike(piece, style, 0.95f, 0.25f, 0.45f);
    if (key.contains("china")) return buildCrashLike(piece, style, 0.70f, 0.62f, 0.95f);
    if (key.contains("crash2")) return buildCrashLike(piece, style, 0.65f, 0.80f, 0.70f);
    if (key.contains("crash") || piece.family == "cymbal") return buildCrashLike(piece, style, 0.90f, 0.65f, 0.60f);
    return buildRimshot(piece, style);
}

} // namespace

fm::FmPatch FmDrumInstrument::makePatch() const {
    sls::inst::DrumPieceSpec piece;
    piece.id = "kickAcoustic";
    piece.displayName = "Kick Acoustic";
    piece.family = "kick";
    piece.kitId = "globalHybridA";
    return buildForPiece(piece);
}

fm::FmPatch FmDrumInstrument::makePatchForPiece(const DrumPieceSpec& piece) const {
    return buildForPiece(piece);
}

} // namespace sls::engine
