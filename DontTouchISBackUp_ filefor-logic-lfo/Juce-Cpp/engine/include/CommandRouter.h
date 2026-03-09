#pragma once
#include <juce_core/juce_core.h>
#include "AudioEngineCore.h"
#include "EngineCommand.h"

/*
  CommandRouter
  =============
  Converts JSON/IPC operations into core-engine method calls.
  Keep this on the control thread only; never call from the realtime callback.
*/

class CommandRouter {
public:
  explicit CommandRouter(AudioEngineCore& core);

  bool dispatch(const EngineCommand& cmd, juce::String& errorOut);
  bool dispatch(const juce::String& op, const juce::var& data, juce::String& errorOut);

private:
  AudioEngineCore& mCore;
};
