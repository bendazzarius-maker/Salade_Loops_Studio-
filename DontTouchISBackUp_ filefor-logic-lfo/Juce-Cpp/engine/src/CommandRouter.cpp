#include "CommandRouter.h"
#include <vector>

namespace {
int getInt(const juce::var& v, const char* key, int fallback = 0) {
  if (auto* o = v.getDynamicObject()) {
    const auto x = o->getProperty(key);
    if (x.isInt() || x.isInt64() || x.isDouble()) return static_cast<int>(x);
  }
  return fallback;
}

float getFloat(const juce::var& v, const char* key, float fallback = 0.0f) {
  if (auto* o = v.getDynamicObject()) {
    const auto x = o->getProperty(key);
    if (x.isInt() || x.isInt64() || x.isDouble()) return static_cast<float>(double(x));
  }
  return fallback;
}

bool getBool(const juce::var& v, const char* key, bool fallback = false) {
  if (auto* o = v.getDynamicObject()) {
    const auto x = o->getProperty(key);
    if (x.isBool()) return static_cast<bool>(x);
    if (x.isInt() || x.isInt64() || x.isDouble()) return static_cast<int>(x) != 0;
  }
  return fallback;
}

juce::String getString(const juce::var& v, const char* key, const juce::String& fallback = {}) {
  if (auto* o = v.getDynamicObject()) {
    const auto x = o->getProperty(key);
    if (x.isString()) return x.toString();
  }
  return fallback;
}
}

CommandRouter::CommandRouter(AudioEngineCore& core) : mCore(core) {}

bool CommandRouter::dispatch(const juce::String& op, const juce::var& data, juce::String& errorOut) {
  EngineCommand cmd;
  cmd.op = op;
  cmd.data = data;
  cmd.type = parseEngineCommandType(op);
  return dispatch(cmd, errorOut);
}

bool CommandRouter::dispatch(const EngineCommand& cmd, juce::String& errorOut) {
  errorOut.clear();

  switch (cmd.type) {
    case EngineCommandType::EngineHello:
    case EngineCommandType::EnginePing:
      return true;

    case EngineCommandType::TransportPlay:
      mCore.setTransport(mCore.scheduler().bpm(), mCore.scheduler().samplePos(), true);
      return true;

    case EngineCommandType::TransportStop:
      mCore.setTransport(mCore.scheduler().bpm(), mCore.scheduler().samplePos(), false);
      return true;

    case EngineCommandType::TransportSeek:
      mCore.setTransport(mCore.scheduler().bpm(), static_cast<int64_t>(getInt(cmd.data, "samplePos", 0)), mCore.scheduler().playing());
      return true;

    case EngineCommandType::TransportBpm:
      mCore.setTransport(getFloat(cmd.data, "bpm", static_cast<float>(mCore.scheduler().bpm())), mCore.scheduler().samplePos(), mCore.scheduler().playing());
      return true;

    case EngineCommandType::MixerInit:
      return true;

    case EngineCommandType::MixerParamSet: {
      const auto scope = getString(cmd.data, "scope", "channel");
      const auto param = getString(cmd.data, "param", {});
      const auto value = getFloat(cmd.data, "value", 0.0f);
      if (scope == "master") {
        mCore.mixer().setMasterParam(param.toStdString(), value);
      } else {
        mCore.mixer().setChannelParam(getInt(cmd.data, "ch", 0), param.toStdString(), value);
      }
      return true;
    }

    case EngineCommandType::MixerCompatMaster: {
      if (auto* o = cmd.data.getDynamicObject()) {
        static const char* kParams[] = {"gain", "pan", "cross", "eqLow", "eqMid", "eqHigh"};
        for (auto* p : kParams) {
          const auto x = o->getProperty(p);
          if (x.isInt() || x.isInt64() || x.isDouble())
            mCore.mixer().setMasterParam(p, static_cast<float>(double(x)));
        }
      }
      return true;
    }

    case EngineCommandType::MixerCompatChannel: {
      const int ch = getInt(cmd.data, "ch", 0);
      if (auto* o = cmd.data.getDynamicObject()) {
        static const char* kParams[] = {"gain", "pan", "eqLow", "eqMid", "eqHigh"};
        for (auto* p : kParams) {
          const auto x = o->getProperty(p);
          if (x.isInt() || x.isInt64() || x.isDouble())
            mCore.mixer().setChannelParam(ch, p, static_cast<float>(double(x)));
        }
        const auto xa = o->getProperty("xAssign");
        if (xa.isInt() || xa.isInt64() || xa.isDouble())
          mCore.mixer().setChannelXAssign(ch, static_cast<XAssign>(juce::jlimit(0, 2, static_cast<int>(xa))));
      }
      return true;
    }

    case EngineCommandType::FxChainSet: {
      std::vector<std::string> types;
      if (auto* o = cmd.data.getDynamicObject()) {
        const auto arr = o->getProperty("types");
        if (arr.isArray()) {
          for (const auto& x : *arr.getArray())
            types.push_back(x.toString().toStdString());
        }
      }
      mCore.mixer().setFxChain(getInt(cmd.data, "ch", 0), types);
      return true;
    }

    case EngineCommandType::FxParamSet:
      mCore.mixer().setFxParam(getInt(cmd.data, "ch", 0), getInt(cmd.data, "fxIndex", 0), getString(cmd.data, "param", {}).toStdString(), getFloat(cmd.data, "value", 0.0f));
      return true;

    case EngineCommandType::FxBypassSet:
      mCore.mixer().setFxBypass(getInt(cmd.data, "ch", 0), getInt(cmd.data, "fxIndex", 0), getBool(cmd.data, "bypass", false));
      return true;

    case EngineCommandType::LfoPresetSet: {
      LfoPresetState st;
      st.id = getInt(cmd.data, "id", 0);
      st.rateHz = getFloat(cmd.data, "rateHz", 1.0f);
      st.depth = getFloat(cmd.data, "depth", 1.0f);
      st.offset = getFloat(cmd.data, "offset", 0.0f);
      st.phase = getFloat(cmd.data, "phase", 0.0f);
      st.smoothing = getFloat(cmd.data, "smoothing", 0.0f);
      st.tempoSync = getBool(cmd.data, "tempoSync", false);
      mCore.presetLfo().upsertPreset(st);
      return true;
    }

    case EngineCommandType::LfoPresetRemove:
      mCore.presetLfo().removePreset(getInt(cmd.data, "id", 0));
      return true;

    case EngineCommandType::LfoCurveSet: {
      LfoCurveState st;
      st.id = getInt(cmd.data, "id", 0);
      st.depth = getFloat(cmd.data, "depth", 1.0f);
      st.offset = getFloat(cmd.data, "offset", 0.0f);
      st.phase = getFloat(cmd.data, "phase", 0.0f);
      st.smoothing = getFloat(cmd.data, "smoothing", 0.0f);
      st.tempoSync = getBool(cmd.data, "tempoSync", false);
      if (auto* o = cmd.data.getDynamicObject()) {
        st.curve.ax = getFloat(cmd.data, "ax", 0.0f);
        st.curve.ay = getFloat(cmd.data, "ay", 0.0f);
        st.curve.bx = getFloat(cmd.data, "bx", 0.5f);
        st.curve.by = getFloat(cmd.data, "by", 0.5f);
        st.curve.cx = getFloat(cmd.data, "cx", 1.0f);
        st.curve.cy = getFloat(cmd.data, "cy", 1.0f);
        (void)o;
      }
      mCore.curveLfo().upsertCurve(st);
      return true;
    }

    case EngineCommandType::LfoCurveRemove:
      mCore.curveLfo().removeCurve(getInt(cmd.data, "id", 0));
      return true;

    case EngineCommandType::LfoRouteSet:
    case EngineCommandType::LfoRouteClear:
      // Stub on purpose: routing format should be finalized before hard-wiring.
      return true;

    default:
      errorOut = "Unsupported op: " + cmd.op;
      return false;
  }
}
