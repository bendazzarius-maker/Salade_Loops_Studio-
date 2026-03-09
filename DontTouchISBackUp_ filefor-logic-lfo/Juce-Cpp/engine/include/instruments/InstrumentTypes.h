#pragma once

#include <array>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include <juce_core/juce_core.h>

namespace sls::inst {

struct VoiceState {
    bool active = false;
    bool releasing = false;
    juce::String instId = "global";
    int mixCh = 1;
    int note = 60;
    float velocity = 0.8f;
    float gain = 1.0f;
    float attack = 0.003f;
    float decay = 0.12f;
    float sustain = 0.7f;
    float release = 0.2f;
    int waveform = 0;
    float fm = 0.0f;
    double phase = 0.0;
    double phaseInc = 0.0;
    int ageSamples = 0;
    float env = 0.0f;
    float filterCutoffHz = 12000.0f;
    float filterResonance = 0.7f;
    float detuneCents = 0.0f;
};

struct DrumOperatorSpec {
    bool enabled = true;
    float level = 75.0f;     // 0..100
    float ratio = 1.0f;
    float detune = 50.0f;    // 0..100, centered at 50
    float attack = 25.0f;    // 0..100
    float release = 35.0f;   // 0..100
};

struct DrumPieceSpec {
    juce::String id;
    juce::String name;
    juce::String displayName;
    juce::String family;
    juce::String presetId;
    juce::String articulation;
    juce::String kitId;

    int midiNote = 36;
    int midiPitchClass = 0;
    int mixChannel = 1;

    float level = 1.0f;
    float pan = 0.0f;
    bool mute = false;
    bool solo = false;

    float attack = 0.001f;
    float decay = 0.12f;
    float tone = 0.5f;
    float pitch = 0.5f;
    float noise = 0.0f;
    float drive = 0.0f;

    // Live controls coming from Drum Machine FM.
    float tune = 50.0f;          // 0..100, centered at 50
    float feedback = 50.0f;      // 0..100
    float noiseMix = 0.0f;       // 0..100
    float beater = 50.0f;        // kick/body or macro1
    float shell = 50.0f;         // kick/body or macro2
    float acousticDepth = 50.0f; // macro3
    float punch = 50.0f;         // macro4
    float operatorMixX = 0.5f;   // 0..1
    float operatorMixY = 0.5f;   // 0..1
    int algorithm = 0;

    std::array<float, 4> macros { 50.0f, 50.0f, 50.0f, 50.0f };
    std::array<DrumOperatorSpec, 4> operators {};
    bool operatorsEdited = false;
    juce::NamedValueSet extra;
};

struct InstrumentState {
    juce::String type = "piano";
    float gain = 1.0f;
    float attack = 0.003f;
    float decay = 0.12f;
    float sustain = 0.7f;
    float release = 0.2f;
    float fm = 0.0f;
    int waveform = 0;
    int polyphony = 12;
    float cutoffHz = 12000.0f;
    float resonance = 0.7f;
    float detuneCents = 0.0f;
    float vibratoRateHz = 0.0f;
    float vibratoDepthCents = 0.0f;
    float drive = 0.0f;
    float subLevel = 0.0f;
    juce::NamedValueSet extra;
    juce::var juceSpec;
    // For drums, key by absolute midi note when available.
    std::unordered_map<int, DrumPieceSpec> drumMap;
};

using ParamMap = std::unordered_map<std::string, float>;

} // namespace sls::inst
