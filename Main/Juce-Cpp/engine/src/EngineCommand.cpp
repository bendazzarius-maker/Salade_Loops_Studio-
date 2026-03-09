#include "EngineCommand.h"

EngineCommandType parseEngineCommandType(const juce::String& op) {
  if (op == "engine.hello") return EngineCommandType::EngineHello;
  if (op == "engine.ping") return EngineCommandType::EnginePing;
  if (op == "transport.play") return EngineCommandType::TransportPlay;
  if (op == "transport.stop") return EngineCommandType::TransportStop;
  if (op == "transport.seek") return EngineCommandType::TransportSeek;
  if (op == "transport.bpm") return EngineCommandType::TransportBpm;
  if (op == "mixer.init") return EngineCommandType::MixerInit;
  if (op == "mixer.param.set") return EngineCommandType::MixerParamSet;
  if (op == "mixer.master.set") return EngineCommandType::MixerCompatMaster;
  if (op == "mixer.channel.set") return EngineCommandType::MixerCompatChannel;
  if (op == "fx.chain.set") return EngineCommandType::FxChainSet;
  if (op == "fx.param.set") return EngineCommandType::FxParamSet;
  if (op == "fx.bypass.set") return EngineCommandType::FxBypassSet;
  if (op == "lfo.preset.set") return EngineCommandType::LfoPresetSet;
  if (op == "lfo.preset.remove") return EngineCommandType::LfoPresetRemove;
  if (op == "lfo.curve.set") return EngineCommandType::LfoCurveSet;
  if (op == "lfo.curve.remove") return EngineCommandType::LfoCurveRemove;
  if (op == "lfo.route.set") return EngineCommandType::LfoRouteSet;
  if (op == "lfo.route.clear") return EngineCommandType::LfoRouteClear;
  return EngineCommandType::Unknown;
}

const char* toString(EngineCommandType type) {
  switch (type) {
    case EngineCommandType::EngineHello: return "engine.hello";
    case EngineCommandType::EnginePing: return "engine.ping";
    case EngineCommandType::TransportPlay: return "transport.play";
    case EngineCommandType::TransportStop: return "transport.stop";
    case EngineCommandType::TransportSeek: return "transport.seek";
    case EngineCommandType::TransportBpm: return "transport.bpm";
    case EngineCommandType::MixerInit: return "mixer.init";
    case EngineCommandType::MixerParamSet: return "mixer.param.set";
    case EngineCommandType::MixerCompatMaster: return "mixer.master.set";
    case EngineCommandType::MixerCompatChannel: return "mixer.channel.set";
    case EngineCommandType::FxChainSet: return "fx.chain.set";
    case EngineCommandType::FxParamSet: return "fx.param.set";
    case EngineCommandType::FxBypassSet: return "fx.bypass.set";
    case EngineCommandType::LfoPresetSet: return "lfo.preset.set";
    case EngineCommandType::LfoPresetRemove: return "lfo.preset.remove";
    case EngineCommandType::LfoCurveSet: return "lfo.curve.set";
    case EngineCommandType::LfoCurveRemove: return "lfo.curve.remove";
    case EngineCommandType::LfoRouteSet: return "lfo.route.set";
    case EngineCommandType::LfoRouteClear: return "lfo.route.clear";
    case EngineCommandType::Unknown: return "unknown";
    default: return "unknown";
  }
}
