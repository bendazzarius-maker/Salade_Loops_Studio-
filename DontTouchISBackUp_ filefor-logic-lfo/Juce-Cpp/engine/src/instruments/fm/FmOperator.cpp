#include "instruments/fm/FmOperator.h"

namespace sls::engine::fm {

namespace {
constexpr double kTwoPi = 6.28318530717958647692;
}

void FmOperator::prepare(double sampleRate) {
    sampleRate_ = std::max(1.0, sampleRate);
    envelope_.prepare(sampleRate_);
}

void FmOperator::reset() {
    phase_ = 0.0;
    velocity_ = 1.0f;
    previousSample_ = 0.0f;
    noteFrequency_ = 440.0;
    envelope_.reset();
}

void FmOperator::start(double noteFrequency, float velocity) {
    noteFrequency_ = noteFrequency;
    velocity_ = velocity;
    envelope_.noteOn();
}

void FmOperator::stop() {
    envelope_.noteOff();
}

float FmOperator::render(float modulationRadians) {
    const float env = envelope_.getNextSample();
    if (!envelope_.isActive() && env <= 0.0f) {
        previousSample_ = 0.0f;
        return 0.0f;
    }

    const double freq = currentFrequency(noteFrequency_);
    const double phaseInc = (kTwoPi * freq) / sampleRate_;
    phase_ += phaseInc;
    if (phase_ >= kTwoPi) phase_ -= kTwoPi;

    const float velScale = 1.0f - params_.velocitySensitivity + (params_.velocitySensitivity * velocity_);
    const float fb = params_.feedback * previousSample_;
    const float sample = std::sin(static_cast<float>(phase_) + modulationRadians + fb)
                       * env * params_.outputLevel * velScale;
    previousSample_ = sample;
    return sample;
}

double FmOperator::currentFrequency(double noteFrequency) const noexcept {
    if (params_.fixedFrequency) return std::max(0.0, params_.fixedFrequencyHz + params_.detuneHz);
    return std::max(0.0, noteFrequency * params_.ratio + params_.detuneHz);
}

} // namespace sls::engine::fm
