#include "instruments/DrumRuntime.h"

#include <algorithm>
#include <cmath>

namespace sls::engine {

void DrumRuntime::prepare(double sampleRate, int maxVoicesPerPiece) {
    sampleRate_ = std::max(1.0, sampleRate);
    maxVoicesPerPiece_ = std::max(1, maxVoicesPerPiece);
    for (auto& [note, pieceRt] : noteMap_) {
        pieceRt.engine.prepare(sampleRate_, maxVoicesPerPiece_);
        pieceRt.engine.setPatch(pieceRt.patch);
        pieceRt.prepared = true;
        (void) note;
    }
}

void DrumRuntime::reset() {
    for (auto& [note, pieceRt] : noteMap_) {
        pieceRt.engine.reset();
        (void) note;
    }
}

void DrumRuntime::syncFromInstrumentState(const sls::inst::InstrumentState& state) {
    noteMap_.clear();

    for (const auto& [noteKey, piece] : state.drumMap) {
        PieceRuntime rt;
        rt.spec = piece;
        rt.routing.pieceId = piece.id.isNotEmpty() ? piece.id : piece.name;
        rt.routing.displayName = piece.displayName.isNotEmpty() ? piece.displayName : piece.name;
        rt.routing.family = piece.family;
        rt.routing.presetId = piece.presetId;
        rt.routing.midiNote = piece.midiNote > 0 ? piece.midiNote : noteKey;
        rt.routing.mixChannel = std::max(1, piece.mixChannel);
        rt.routing.level = piece.level;
        rt.routing.mute = piece.mute;
        rt.routing.solo = piece.solo;
        rt.fallbackMixChannel = rt.routing.mixChannel;
        rt.patch = factory_.makePatchForPiece(piece);

        if (sampleRate_ > 1.0) {
            rt.engine.prepare(sampleRate_, maxVoicesPerPiece_);
            rt.engine.setPatch(rt.patch);
            rt.prepared = true;
        }

        noteMap_[rt.routing.midiNote] = std::move(rt);
    }
}

bool DrumRuntime::hasMappingForNote(int midiNote) const {
    return findPieceRuntimeForNote(midiNote) != nullptr;
}

const DrumRuntime::PieceRouting* DrumRuntime::getPieceRouting(int midiNote) const {
    const auto* piece = findPieceRuntimeForNote(midiNote);
    return piece ? &piece->routing : nullptr;
}

void DrumRuntime::noteOn(const juce::String& instId, int midiNote, float velocity, int fallbackMixChannel) {
    auto* piece = findPieceRuntimeForNote(midiNote);
    if (!piece) return;

    piece->routing.pieceId = piece->routing.pieceId.isNotEmpty() ? piece->routing.pieceId : instId;
    piece->routing.mixChannel = std::max(1, piece->spec.mixChannel > 0 ? piece->spec.mixChannel : fallbackMixChannel);
    piece->fallbackMixChannel = std::max(1, fallbackMixChannel);

    if (!piece->prepared) {
        piece->engine.prepare(sampleRate_, maxVoicesPerPiece_);
        piece->engine.setPatch(piece->patch);
        piece->prepared = true;
    }

    piece->engine.noteOn(piece->routing.midiNote, juce::jlimit(0.0f, 1.0f, velocity * piece->spec.level));
}

void DrumRuntime::noteOff(int midiNote) {
    auto* piece = findPieceRuntimeForNote(midiNote);
    if (!piece) return;
    piece->engine.noteOff(piece->routing.midiNote);
}

std::vector<DrumRuntime::RenderTap> DrumRuntime::renderFrame() {
    std::vector<RenderTap> taps;
    taps.reserve(noteMap_.size());

    for (auto& [note, piece] : noteMap_) {
        const auto frame = piece.engine.renderFrame();
        if (std::abs(frame.first) < 1.0e-8f && std::abs(frame.second) < 1.0e-8f) {
            (void) note;
            continue;
        }

        RenderTap tap;
        tap.mixChannel = std::max(1, piece.routing.mixChannel > 0 ? piece.routing.mixChannel : piece.fallbackMixChannel);
        tap.left = frame.first;
        tap.right = frame.second;
        tap.pieceId = piece.routing.pieceId;
        taps.push_back(std::move(tap));
        (void) note;
    }

    return taps;
}

DrumRuntime::PieceRuntime* DrumRuntime::findPieceRuntimeForNote(int midiNote) {
    auto it = noteMap_.find(midiNote);
    return it != noteMap_.end() ? &it->second : nullptr;
}

const DrumRuntime::PieceRuntime* DrumRuntime::findPieceRuntimeForNote(int midiNote) const {
    auto it = noteMap_.find(midiNote);
    return it != noteMap_.end() ? &it->second : nullptr;
}

} // namespace sls::engine
