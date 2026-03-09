#pragma once

#include <cmath>
#include "FmEnvelope.h"

namespace sls::engine::fm {

struct FmOperatorParams {
    double ratio = 1.0;
    double detuneHz = 0.0;
    float outputLevel = 1.0f;
    float velocitySensitivity = 0.5f;
    float feedback = 0.0f;
    bool fixedFrequency = false;
    double fixedFrequencyHz = 440.0;
};

class FmOperator {
public:
    void prepare(double sampleRate);
    void reset();

    FmOperatorParams& params() noexcept { return params_; }
    const FmOperatorParams& params() const noexcept { return params_; }

    FmEnvelope& envelope() noexcept { return envelope_; }
    const FmEnvelope& envelope() const noexcept { return envelope_; }

    void start(double noteFrequency, float velocity);
    void stop();

    float render(float modulationRadians);
    bool isActive() const noexcept { return envelope_.isActive(); }

private:
    double currentFrequency(double noteFrequency) const noexcept;

    double sampleRate_ = 48000.0;
    double phase_ = 0.0;
    float velocity_ = 1.0f;
    float previousSample_ = 0.0f;
    double noteFrequency_ = 440.0;

    FmOperatorParams params_;
    FmEnvelope envelope_;
};

} // namespace sls::engine::fm
