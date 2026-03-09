#pragma once

#include <algorithm>
#include <cmath>

namespace sls::engine::fm {

enum class EnvelopeStage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release
};

class FmEnvelope {
public:
    void prepare(double sampleRate);
    void reset();

    void setAttack(double seconds);
    void setDecay(double seconds);
    void setSustain(float level);
    void setRelease(double seconds);

    void noteOn();
    void noteOff();
    float getNextSample();

    bool isActive() const noexcept { return stage_ != EnvelopeStage::Idle; }
    EnvelopeStage stage() const noexcept { return stage_; }

private:
    void updateCoefficients();

    double sampleRate_ = 48000.0;
    double attackSeconds_ = 0.005;
    double decaySeconds_ = 0.08;
    double releaseSeconds_ = 0.16;
    float sustainLevel_ = 0.7f;

    float value_ = 0.0f;
    float attackStep_ = 0.0f;
    float decayStep_ = 0.0f;
    float releaseStep_ = 0.0f;
    EnvelopeStage stage_ = EnvelopeStage::Idle;
};

} // namespace sls::engine::fm
