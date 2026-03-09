#include "instruments/fm/FmEnvelope.h"

namespace sls::engine::fm {

void FmEnvelope::prepare(double sampleRate) {
    sampleRate_ = std::max(1.0, sampleRate);
    updateCoefficients();
}

void FmEnvelope::reset() {
    value_ = 0.0f;
    stage_ = EnvelopeStage::Idle;
}

void FmEnvelope::setAttack(double seconds)  { attackSeconds_  = std::max(0.0001, seconds); updateCoefficients(); }
void FmEnvelope::setDecay(double seconds)   { decaySeconds_   = std::max(0.0001, seconds); updateCoefficients(); }
void FmEnvelope::setSustain(float level)    { sustainLevel_   = std::clamp(level, 0.0f, 1.0f); updateCoefficients(); }
void FmEnvelope::setRelease(double seconds) { releaseSeconds_ = std::max(0.0001, seconds); updateCoefficients(); }

void FmEnvelope::noteOn() {
    stage_ = EnvelopeStage::Attack;
    if (value_ <= 0.0f) value_ = 0.0f;
}

void FmEnvelope::noteOff() {
    if (stage_ != EnvelopeStage::Idle) {
        stage_ = EnvelopeStage::Release;
        releaseStep_ = value_ / static_cast<float>(std::max(1.0, releaseSeconds_ * sampleRate_));
    }
}

float FmEnvelope::getNextSample() {
    switch (stage_) {
        case EnvelopeStage::Idle:
            return 0.0f;
        case EnvelopeStage::Attack:
            value_ += attackStep_;
            if (value_ >= 1.0f) {
                value_ = 1.0f;
                stage_ = EnvelopeStage::Decay;
            }
            break;
        case EnvelopeStage::Decay:
            value_ -= decayStep_;
            if (value_ <= sustainLevel_) {
                value_ = sustainLevel_;
                stage_ = EnvelopeStage::Sustain;
            }
            break;
        case EnvelopeStage::Sustain:
            value_ = sustainLevel_;
            break;
        case EnvelopeStage::Release:
            value_ -= releaseStep_;
            if (value_ <= 0.0f) {
                value_ = 0.0f;
                stage_ = EnvelopeStage::Idle;
            }
            break;
    }
    return value_;
}

void FmEnvelope::updateCoefficients() {
    attackStep_ = 1.0f / static_cast<float>(std::max(1.0, attackSeconds_ * sampleRate_));
    decayStep_ = (1.0f - sustainLevel_) / static_cast<float>(std::max(1.0, decaySeconds_ * sampleRate_));
    releaseStep_ = std::max(0.000001f, sustainLevel_) / static_cast<float>(std::max(1.0, releaseSeconds_ * sampleRate_));
}

} // namespace sls::engine::fm
