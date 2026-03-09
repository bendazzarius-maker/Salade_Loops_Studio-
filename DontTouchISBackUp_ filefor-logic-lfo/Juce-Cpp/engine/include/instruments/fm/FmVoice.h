#pragma once

#include <array>
#include <utility>
#include "FmPatch.h"

namespace sls::engine::fm {

class FmVoice {
public:
    void prepare(double sampleRate);
    void reset();
    void setPatch(const FmPatch& patch);

    void noteOn(int midiNote, float velocity);
    void noteOff();

    std::pair<float, float> renderFrame();
    bool isActive() const noexcept;
    int currentMidiNote() const noexcept { return midiNote_; }

private:
    double midiNoteToFrequency(int midiNote) const noexcept;

    double sampleRate_ = 48000.0;
    int midiNote_ = -1;
    float velocity_ = 0.0f;
    float lfoPhase_ = 0.0f;
    FmPatch patch_;
    std::array<FmOperator, kMaxFmOperators> operators_ {};
};

} // namespace sls::engine::fm
