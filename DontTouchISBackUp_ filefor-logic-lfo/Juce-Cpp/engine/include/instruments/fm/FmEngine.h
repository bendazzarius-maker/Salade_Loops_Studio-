#pragma once

#include <memory>
#include <utility>
#include <vector>
#include "FmVoice.h"

namespace sls::engine::fm {

class FmEngine {
public:
    void prepare(double sampleRate, int maxVoices);
    void reset();
    void setPatch(const FmPatch& patch);

    void noteOn(int midiNote, float velocity);
    void noteOff(int midiNote);

    std::pair<float, float> renderFrame();

private:
    FmVoice* findVoice(int midiNote);
    FmVoice* findFreeVoice();

    double sampleRate_ = 48000.0;
    int nextStealIndex_ = 0;
    FmPatch patch_;
    std::vector<std::unique_ptr<FmVoice>> voices_;
};

} // namespace sls::engine::fm
