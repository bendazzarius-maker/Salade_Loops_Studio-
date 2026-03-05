// Skeleton files generated for Salad Loops Studio JUCE engine modularization.
// Generated: 2026-03-03
// NOTE: main.cpp is intentionally NOT included (already exists).
// These files are placeholders with TODOs and interface notes.

#pragma once
#include <memory>
#include <string>
#include "FxBase.h"

/*
  FxFactory
  =========
  Creates FxBase by string type:
  "delay", "chorus", "flanger", "compressor", "grossbeat", "reverb"
*/

class FxFactory {
public:
  std::unique_ptr<FxBase> create(const std::string& type);
};
