#pragma once
#include <string>
#include <cstdint>
#include <juce_core/juce_core.h>

/*
  EngineCommand
  =============
  Shared command declarations for the refactorized engine layout.
  Goal: remove IPC/op parsing details from main.cpp and centralize routing.
*/

enum class EngineCommandType : uint8_t {
  Unknown = 0,
  EngineHello,
  EnginePing,
  TransportPlay,
  TransportStop,
  TransportSeek,
  TransportBpm,
  MixerInit,
  MixerParamSet,
  MixerCompatMaster,
  MixerCompatChannel,
  FxChainSet,
  FxParamSet,
  FxBypassSet,
  LfoPresetSet,
  LfoPresetRemove,
  LfoCurveSet,
  LfoCurveRemove,
  LfoRouteSet,
  LfoRouteClear,
};

struct EngineCommand {
  EngineCommandType type = EngineCommandType::Unknown;
  juce::String op;
  juce::var data;
};

EngineCommandType parseEngineCommandType(const juce::String& op);
const char* toString(EngineCommandType type);
