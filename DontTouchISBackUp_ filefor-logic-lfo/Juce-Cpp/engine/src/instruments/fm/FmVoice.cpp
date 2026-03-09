#include "instruments/fm/FmVoice.h"
#include <cmath>

namespace sls::engine::fm {

namespace {
constexpr float kTwoPiF = 6.28318530717958647692f;
}

void FmVoice::prepare(double sampleRate) {
    sampleRate_ = std::max(1.0, sampleRate);
    for (auto& op : operators_) op.prepare(sampleRate_);
}

void FmVoice::reset() {
    midiNote_ = -1;
    velocity_ = 0.0f;
    lfoPhase_ = 0.0f;
    for (auto& op : operators_) op.reset();
}

void FmVoice::setPatch(const FmPatch& patch) {
    patch_ = patch;
    for (std::size_t i = 0; i < operators_.size(); ++i) {
        operators_[i].params() = patch_.operators[i];
        operators_[i].envelope().setAttack(patch_.attack[i]);
        operators_[i].envelope().setDecay(patch_.decay[i]);
        operators_[i].envelope().setSustain(patch_.sustain[i]);
        operators_[i].envelope().setRelease(patch_.release[i]);
    }
}

void FmVoice::noteOn(int midiNote, float velocity) {
    midiNote_ = midiNote;
    velocity_ = velocity;
    const double freq = midiNoteToFrequency(midiNote);
    for (auto& op : operators_) op.start(freq, velocity_);
}

void FmVoice::noteOff() {
    for (auto& op : operators_) op.stop();
}

std::pair<float, float> FmVoice::renderFrame() {
    if (!isActive()) return { 0.0f, 0.0f };

    const auto& algorithm = FmAlgorithms::byIndex(patch_.voice.algorithm);
    std::array<float, kMaxFmOperators> outputs {};

    if (patch_.voice.lfoRateHz > 0.0f && patch_.voice.lfoDepth > 0.0f) {
        lfoPhase_ += (kTwoPiF * patch_.voice.lfoRateHz) / static_cast<float>(sampleRate_);
        if (lfoPhase_ >= kTwoPiF) lfoPhase_ -= kTwoPiF;
    }
    const float lfo = std::sin(lfoPhase_) * patch_.voice.lfoDepth;

    for (int i = static_cast<int>(kMaxFmOperators) - 1; i >= 0; --i) {
        float modulation = 0.0f;
        for (int mod : algorithm.nodes[static_cast<std::size_t>(i)].modulators) {
            if (mod >= 0) modulation += outputs[static_cast<std::size_t>(mod)];
        }
        outputs[static_cast<std::size_t>(i)] = operators_[static_cast<std::size_t>(i)].render(modulation + lfo);
    }

    float mono = 0.0f;
    for (std::size_t i = 0; i < algorithm.nodes.size(); ++i) {
        if (algorithm.nodes[i].isCarrier) mono += outputs[i];
    }
    mono *= patch_.voice.masterGain;

    const float width = std::clamp(patch_.voice.stereoWidth, 0.0f, 1.0f);
    const float side = outputs[2] * width * 0.35f;
    return { mono - side, mono + side };
}

bool FmVoice::isActive() const noexcept {
    for (const auto& op : operators_) {
        if (op.isActive()) return true;
    }
    return false;
}

double FmVoice::midiNoteToFrequency(int midiNote) const noexcept {
    return 440.0 * std::pow(2.0, (static_cast<double>(midiNote) - 69.0) / 12.0);
}

} // namespace sls::engine::fm
