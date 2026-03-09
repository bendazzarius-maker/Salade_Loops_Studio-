// Skeleton files generated for Salad Loops Studio JUCE engine modularization.
// Generated: 2026-03-03
// NOTE: main.cpp is intentionally NOT included (already exists).
// These files are placeholders with TODOs and interface notes.

#pragma once
#include <cstdint>
#include <string>
#include <vector>

/*
  ModMatrix
  =========
  Applies LFO sources (preset + curve) to targets:
  - mixer params: gain/pan/eqLow/eqMid/eqHigh/cross
  - fx params: wet/rate/depth/feedback/etc (per channel, per fxIndex)
  Runs in audio thread (block-accurate or sample-accurate).

  IPC:
   - lfo.route.set {sourceType, sourceId, targetScope, ch, fxIndex, param, amount, offset, smoothing}
*/

enum class LfoSourceType : uint8_t { Preset=0, Curve=1 };

enum class TargetScope : uint8_t { MixerMaster=0, MixerChannel=1, FxParam=2 };

struct ModRoute {
  LfoSourceType sourceType = LfoSourceType::Preset;
  int sourceId = 0;

  TargetScope scope = TargetScope::MixerChannel;
  int ch = 0;
  int fxIndex = 0;          // only for FxParam
  std::string param;        // target param name

  float amount = 1.0f;      // multiplier
  float offset = 0.0f;      // base offset
  float smoothing = 0.0f;   // per-route smoothing
};

class ModMatrix {
public:
  void setRoutes(const std::vector<ModRoute>& routes);
  const std::vector<ModRoute>& routes() const { return mRoutes; }

private:
  std::vector<ModRoute> mRoutes;
};
