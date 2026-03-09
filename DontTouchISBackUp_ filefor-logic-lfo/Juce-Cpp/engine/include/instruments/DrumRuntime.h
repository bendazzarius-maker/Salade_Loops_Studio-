#pragma once

#include <unordered_map>
#include <vector>

#include <juce_core/juce_core.h>

#include "instruments/InstrumentTypes.h"
#include "instruments/FmDrumInstrument.h"
#include "instruments/fm/FmEngine.h"

namespace sls::engine {

class DrumRuntime {
public:
    struct PieceRouting {
        juce::String pieceId;
        juce::String displayName;
        juce::String family;
        juce::String presetId;
        int midiNote = 36;
        int mixChannel = 1;
        float level = 1.0f;
        bool mute = false;
        bool solo = false;
    };

    struct RenderTap {
        int mixChannel = 1;
        float left = 0.0f;
        float right = 0.0f;
        juce::String pieceId;
    };

    void prepare(double sampleRate, int maxVoicesPerPiece);
    void reset();
    void syncFromInstrumentState(const sls::inst::InstrumentState& state);

    bool hasMappingForNote(int midiNote) const;
    const PieceRouting* getPieceRouting(int midiNote) const;

    void noteOn(const juce::String& instId, int midiNote, float velocity, int fallbackMixChannel = 1);
    void noteOff(int midiNote);
    std::vector<RenderTap> renderFrame();

private:
    struct PieceRuntime {
        sls::inst::DrumPieceSpec spec;
        PieceRouting routing;
        int fallbackMixChannel = 1;
        bool prepared = false;
        fm::FmPatch patch;
        fm::FmEngine engine;
    };

    PieceRuntime* findPieceRuntimeForNote(int midiNote);
    const PieceRuntime* findPieceRuntimeForNote(int midiNote) const;

    double sampleRate_ = 48000.0;
    int maxVoicesPerPiece_ = 8;
    FmDrumInstrument factory_;
    std::unordered_map<int, PieceRuntime> noteMap_;
};

} // namespace sls::engine
