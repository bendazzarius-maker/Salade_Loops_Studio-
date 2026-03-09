#include "instruments/fm/FmEngine.h"

namespace sls::engine::fm {

void FmEngine::prepare(double sampleRate, int maxVoices) {
    sampleRate_ = std::max(1.0, sampleRate);
    voices_.clear();
    voices_.reserve(static_cast<std::size_t>(std::max(1, maxVoices)));
    for (int i = 0; i < std::max(1, maxVoices); ++i) {
        auto voice = std::make_unique<FmVoice>();
        voice->prepare(sampleRate_);
        voice->setPatch(patch_);
        voices_.push_back(std::move(voice));
    }
}

void FmEngine::reset() {
    for (auto& voice : voices_) voice->reset();
}

void FmEngine::setPatch(const FmPatch& patch) {
    patch_ = patch;
    for (auto& voice : voices_) voice->setPatch(patch_);
}

void FmEngine::noteOn(int midiNote, float velocity) {
    if (auto* voice = findFreeVoice()) {
        voice->setPatch(patch_);
        voice->noteOn(midiNote, velocity);
        return;
    }
    if (voices_.empty()) return;
    auto* voice = voices_[static_cast<std::size_t>(nextStealIndex_ % voices_.size())].get();
    ++nextStealIndex_;
    voice->setPatch(patch_);
    voice->noteOn(midiNote, velocity);
}

void FmEngine::noteOff(int midiNote) {
    if (auto* voice = findVoice(midiNote)) voice->noteOff();
}

std::pair<float, float> FmEngine::renderFrame() {
    float left = 0.0f;
    float right = 0.0f;
    for (auto& voice : voices_) {
        if (!voice->isActive()) continue;
        auto [l, r] = voice->renderFrame();
        left += l;
        right += r;
    }
    return { left, right };
}

FmVoice* FmEngine::findVoice(int midiNote) {
    for (auto& voice : voices_) {
        if (voice->currentMidiNote() == midiNote && voice->isActive()) return voice.get();
    }
    return nullptr;
}

FmVoice* FmEngine::findFreeVoice() {
    for (auto& voice : voices_) {
        if (!voice->isActive()) return voice.get();
    }
    return nullptr;
}

} // namespace sls::engine::fm
