// Skeleton files generated for Salad Loops Studio JUCE engine modularization.
// Generated: 2026-03-03
// NOTE: main.cpp is intentionally NOT included (already exists).
// These files are placeholders with TODOs and interface notes.

#include "FxFactory.h"
#include "FxDelay.h"
#include "FxChorus.h"
#include "FxFlanger.h"
#include "FxCompressor.h"
#include "FxGrossBeat.h"
#include "FxReverb.h"

std::unique_ptr<FxBase> FxFactory::create(const std::string& type) {
  // NOTE: Keep string matching stable with JS UI type names.
  if (type == "delay") return std::make_unique<FxDelay>();
  if (type == "chorus") return std::make_unique<FxChorus>();
  if (type == "flanger") return std::make_unique<FxFlanger>();
  if (type == "compressor") return std::make_unique<FxCompressor>();
  if (type == "grossbeat") return std::make_unique<FxGrossBeat>();
  if (type == "reverb") return std::make_unique<FxReverb>();
  return nullptr;
}
