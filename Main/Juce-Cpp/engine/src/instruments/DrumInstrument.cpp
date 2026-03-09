#include "instruments/DrumInstrument.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace sls::inst {
namespace {

static float getFloat(const juce::NamedValueSet& params, const juce::String& key, float fallback) {
    const auto* v = params.getVarPointer(key);
    if (!v) return fallback;
    if (v->isInt() || v->isDouble() || v->isBool()) return static_cast<float>(double(*v));
    return fallback;
}

static bool getBoolVar(const juce::var& v, bool fallback = false) {
    if (v.isBool()) return static_cast<bool>(v);
    if (v.isInt() || v.isDouble()) return double(v) != 0.0;
    if (v.isString()) return v.toString().equalsIgnoreCase("true") || v.toString() == "1";
    return fallback;
}

static float getFloatVar(const juce::var& v, float fallback = 0.0f) {
    if (v.isInt() || v.isDouble() || v.isBool()) return static_cast<float>(double(v));
    return fallback;
}

static int getIntVar(const juce::var& v, int fallback = 0) {
    if (v.isInt() || v.isDouble() || v.isBool()) return static_cast<int>(std::llround(double(v)));
    return fallback;
}

static juce::String getStringVar(const juce::var& v, const juce::String& fallback = {}) {
    return v.isVoid() ? fallback : v.toString();
}

static juce::String inferFamily(const juce::String& id) {
    const auto lower = id.toLowerCase();
    if (lower.contains("kick")) return "kick";
    if (lower.contains("snare") || lower.contains("clap") || lower.contains("rim")) return "snare";
    if (lower.contains("hat")) return "hat";
    if (lower.contains("tom")) return "tom";
    if (lower.contains("ride") || lower.contains("crash") || lower.contains("china") || lower.contains("splash") || lower.contains("cym")) return "cymbal";
    return "perc";
}

static DrumPieceSpec makePiece(const juce::String& id,
                               const juce::String& displayName,
                               const juce::String& family,
                               int midiNote,
                               int mixChannel,
                               float level,
                               float attack,
                               float decay,
                               float tone,
                               float pitch,
                               float noise,
                               float drive) {
    DrumPieceSpec s;
    s.id = id;
    s.name = id;
    s.displayName = displayName;
    s.family = family;
    s.presetId = "globalHybridA:" + id;
    s.kitId = "globalHybridA";
    s.midiNote = midiNote;
    s.midiPitchClass = ((midiNote % 12) + 12) % 12;
    s.mixChannel = mixChannel;
    s.level = level;
    s.attack = attack;
    s.decay = decay;
    s.tone = tone;
    s.pitch = pitch;
    s.noise = noise;
    s.noiseMix = noise * 100.0f;
    s.drive = drive;
    return s;
}

static void populateDefaultKit(InstrumentState& st) {
    st.drumMap.clear();
    auto add = [&](const DrumPieceSpec& piece) { st.drumMap[piece.midiNote] = piece; };
    add(makePiece("crash1",      "Crash 1",           "cymbal", 30, 13, 0.82f, 0.001f, 0.58f, 0.82f, 0.76f, 0.38f, 0.08f));
    add(makePiece("china",       "China",             "cymbal", 31, 13, 0.84f, 0.001f, 0.66f, 0.70f, 0.74f, 0.46f, 0.10f));
    add(makePiece("splash",      "Splash",            "cymbal", 32, 13, 0.76f, 0.001f, 0.22f, 0.94f, 0.80f, 0.30f, 0.06f));
    add(makePiece("rideMain",    "Ride Main",         "cymbal", 33, 13, 0.78f, 0.001f, 0.64f, 0.78f, 0.70f, 0.28f, 0.06f));
    add(makePiece("crash2",      "Crash 2",           "cymbal", 34, 13, 0.82f, 0.001f, 0.72f, 0.68f, 0.72f, 0.42f, 0.08f));
    add(makePiece("kickAcoustic", "Kick Acoustic",    "kick",   35, 10, 0.96f, 0.001f, 0.18f, 0.44f, 0.28f, 0.04f, 0.10f));
    add(makePiece("kickSub",     "Kick Sub",          "kick",   36, 10, 1.00f, 0.001f, 0.28f, 0.36f, 0.18f, 0.00f, 0.14f));
    add(makePiece("sideSnare",   "Side Stick",        "snare",  37, 10, 0.76f, 0.001f, 0.05f, 0.54f, 0.48f, 0.14f, 0.02f));
    add(makePiece("rimshotVar",  "Rimshot",           "snare",  38, 10, 0.84f, 0.001f, 0.05f, 0.62f, 0.58f, 0.10f, 0.04f));
    add(makePiece("clapLayer",   "Clap Layer",        "snare",  39, 10, 0.82f, 0.001f, 0.11f, 0.72f, 0.60f, 0.66f, 0.04f));
    add(makePiece("snareMain",   "Snare Main",        "snare",  40, 10, 0.94f, 0.001f, 0.15f, 0.66f, 0.54f, 0.68f, 0.08f));
    add(makePiece("highTom",     "High Tom",          "tom",    41, 12, 0.86f, 0.001f, 0.18f, 0.48f, 0.74f, 0.04f, 0.04f));
    add(makePiece("openCloseHat", "Closed Hat",       "hat",    42, 11, 0.88f, 0.001f, 0.05f, 0.90f, 0.86f, 0.92f, 0.00f));
    add(makePiece("midTom",      "Mid Tom",           "tom",    43, 12, 0.86f, 0.001f, 0.20f, 0.46f, 0.56f, 0.04f, 0.04f));
    add(makePiece("pedalHat",    "Pedal Hat",         "hat",    44, 11, 0.82f, 0.001f, 0.03f, 0.78f, 0.74f, 0.70f, 0.00f));
    add(makePiece("lowTom",      "Low Tom",           "tom",    45, 12, 0.90f, 0.001f, 0.26f, 0.42f, 0.30f, 0.04f, 0.04f));
    add(makePiece("openCloseHat", "Open Hat",         "hat",    46, 11, 0.86f, 0.001f, 0.18f, 0.92f, 0.90f, 0.88f, 0.00f));
    add(makePiece("rideBell",    "Ride Bell",         "cymbal", 47, 13, 0.74f, 0.001f, 0.44f, 0.84f, 0.80f, 0.20f, 0.04f));
}

static void fillPieceFromVoiceAndRow(DrumPieceSpec& piece, const juce::DynamicObject* voice, const juce::DynamicObject* row, const juce::String& kitId) {
    if (row) {
        piece.midiNote = getIntVar(row->getProperty("midi"), piece.midiNote);
        piece.midiPitchClass = ((piece.midiNote % 12) + 12) % 12;
        piece.mixChannel = std::max(1, getIntVar(row->getProperty("channel"), piece.mixChannel));
        piece.articulation = getStringVar(row->getProperty("articulation"), piece.articulation);
    }
    if (voice) {
        piece.displayName = getStringVar(voice->getProperty("name"), piece.displayName);
        piece.name = piece.id.isNotEmpty() ? piece.id : piece.displayName;
        piece.family = inferFamily(piece.id.isNotEmpty() ? piece.id : piece.displayName);
        piece.kitId = kitId;
        piece.presetId = kitId + ":" + piece.id;
        piece.algorithm = getIntVar(voice->getProperty("algorithm"), piece.algorithm);

        if (auto* xy = voice->getProperty("xy").getDynamicObject()) {
            piece.operatorMixX = juce::jlimit(0.0f, 1.0f, getFloatVar(xy->getProperty("x"), piece.operatorMixX));
            piece.operatorMixY = juce::jlimit(0.0f, 1.0f, getFloatVar(xy->getProperty("y"), piece.operatorMixY));
        }

        if (auto* qp = voice->getProperty("quickParams").getDynamicObject()) {
            piece.tune = getFloatVar(qp->getProperty("tune"), piece.tune);
            piece.feedback = getFloatVar(qp->getProperty("feedback"), piece.feedback);
            piece.noiseMix = getFloatVar(qp->getProperty("noiseMix"), piece.noiseMix);
            piece.noise = juce::jlimit(0.0f, 1.0f, piece.noiseMix / 100.0f);
            piece.drive = getFloatVar(qp->getProperty("drive"), piece.drive * 100.0f) / 100.0f;
            piece.beater = piece.macros[0] = getFloatVar(qp->getProperty("macro1"), piece.macros[0]);
            piece.shell = piece.macros[1] = getFloatVar(qp->getProperty("macro2"), piece.macros[1]);
            piece.acousticDepth = piece.macros[2] = getFloatVar(qp->getProperty("macro3"), piece.macros[2]);
            piece.punch = piece.macros[3] = getFloatVar(qp->getProperty("macro4"), piece.macros[3]);
        }

        if (auto* ops = voice->getProperty("operators").getArray()) {
            for (int i = 0; i < juce::jmin<int>(4, ops->size()); ++i) {
                if (auto* op = ops->getReference(i).getDynamicObject()) {
                    auto& dst = piece.operators[static_cast<std::size_t>(i)];
                    dst.enabled = !getBoolVar(op->getProperty("disabled"), false);
                    dst.level = getFloatVar(op->getProperty("level"), dst.level);
                    dst.ratio = getFloatVar(op->getProperty("ratio"), dst.ratio);
                    dst.detune = getFloatVar(op->getProperty("detune"), dst.detune);
                    dst.attack = getFloatVar(op->getProperty("attack"), dst.attack);
                    dst.release = getFloatVar(op->getProperty("release"), dst.release);
                }
            }
        }

        piece.operatorsEdited = getBoolVar(voice->getProperty("operatorsEdited"), false) ||
                                getBoolVar(voice->getProperty("applyOperatorOverrides"), false);

        piece.extra.set("voiceColor", voice->getProperty("color"));
        piece.extra.set("voiceMode", voice->getProperty("mode"));
        piece.extra.set("voiceDesc", voice->getProperty("desc"));
    }
}

static void applyUiSnapshot(InstrumentState& state, const juce::var& snapshotVar) {
    auto* root = snapshotVar.getDynamicObject();
    if (!root) return;
    auto* project = root->getProperty("project").getDynamicObject();
    if (!project) return;

    const auto kitId = getStringVar(project->getProperty("kitId"), "globalHybridA");
    auto* voicesObj = project->getProperty("voices").getDynamicObject();
    auto* rows = project->getProperty("mappingRows").getArray();
    if (!voicesObj || !rows) return;

    state.drumMap.clear();
    for (const auto& rowVar : *rows) {
        auto* row = rowVar.getDynamicObject();
        if (!row) continue;
        const auto voiceId = getStringVar(row->getProperty("voiceId"), {});
        if (voiceId.isEmpty()) continue;

        DrumPieceSpec piece;
        piece.id = voiceId;
        piece.name = voiceId;
        piece.displayName = voiceId;
        piece.family = inferFamily(voiceId);
        piece.kitId = kitId;
        piece.presetId = kitId + ":" + voiceId;

        const juce::var voiceVar = voicesObj->getProperty(voiceId);
        auto* voice = voiceVar.getDynamicObject();
        fillPieceFromVoiceAndRow(piece, voice, row, kitId);
        state.drumMap[piece.midiNote] = piece;
    }

    state.extra.set("drumKitId", kitId);
    state.extra.set("__drumMachineUiState", snapshotVar);
}

} // namespace

InstrumentState DrumInstrument::makeDefaultState() const {
    InstrumentState st;
    st.type = "drums";
    st.gain = 1.0f;
    st.polyphony = 24;
    populateDefaultKit(st);
    return st;
}

void DrumInstrument::applyParams(InstrumentState& state, const juce::NamedValueSet& params) const {
    InstrumentBase::applyParams(state, params);

    if (const auto* uiState = params.getVarPointer("__drumMachineUiState")) {
        applyUiSnapshot(state, *uiState);
        return;
    }

    // Fallback: legacy simple panel values.
    for (auto& [note, piece] : state.drumMap) {
        const juce::String stem = piece.id.isNotEmpty() ? piece.id : piece.name;
        piece.level  = std::max(0.0f, getFloat(params, stem, piece.level));
        piece.attack = std::max(0.0005f, getFloat(params, stem + "Attack", piece.attack));
        piece.decay  = std::max(0.002f, getFloat(params, stem + "Decay", piece.decay));
        piece.tone   = juce::jlimit(0.0f, 1.0f, getFloat(params, stem + "Tone", piece.tone));
        piece.pitch  = juce::jlimit(0.0f, 1.0f, getFloat(params, stem + "Pitch", piece.pitch));
        piece.noise  = juce::jlimit(0.0f, 1.0f, getFloat(params, stem + "Noise", piece.noise));
        piece.noiseMix = piece.noise * 100.0f;
        piece.drive  = juce::jlimit(0.0f, 1.0f, getFloat(params, stem + "Drive", piece.drive));
        (void) note;
    }

    // Optional direct kit controls when sent flat.
    if (const auto* kit = params.getVarPointer("kitId"); kit && !kit->isVoid()) {
        const auto kitId = kit->toString();
        for (auto& [note, piece] : state.drumMap) {
            piece.kitId = kitId;
            piece.presetId = kitId + ":" + (piece.id.isNotEmpty() ? piece.id : piece.name);
            (void) note;
        }
        state.extra.set("drumKitId", kitId);
    }
}

} // namespace sls::inst
