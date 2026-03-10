#include <iostream>
#include <memory>
#include <unordered_map>

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_core/juce_core.h>
#include <juce_gui_basics/juce_gui_basics.h>

namespace {

juce::int64 nowMs() { return juce::Time::currentTimeMillis(); }

juce::String getStringProp(const juce::DynamicObject* d, const char* key, const juce::String& fallback = {}) {
  if (!d || !d->hasProperty(key)) return fallback;
  return d->getProperty(key).toString();
}

juce::Array<juce::String> getStringArrayProp(const juce::DynamicObject* d, const char* key) {
  juce::Array<juce::String> out;
  if (!d || !d->hasProperty(key)) return out;
  const auto v = d->getProperty(key);
  if (!v.isArray()) return out;
  for (const auto& item : *v.getArray()) {
    const auto s = item.toString().trim();
    if (s.isNotEmpty()) out.add(s);
  }
  return out;
}

juce::String normalizeCategory(const juce::PluginDescription& pd) {
  const auto category = pd.category.toLowerCase();
  if (pd.isInstrument || category.contains("instrument") || category.contains("synth")) return "instrument";
  if (category.contains("effect") || category.contains("fx")) return "fx";
  return "unknown";
}

juce::var pluginToVar(const juce::PluginDescription& pd, const juce::String& rootDir) {
  juce::DynamicObject::Ptr o = new juce::DynamicObject();
  const juce::File file(pd.fileOrIdentifier);
  const auto fullPath = file.getFullPathName();

  o->setProperty("name", pd.name);
  o->setProperty("path", fullPath);
  o->setProperty("relativePath", juce::File(rootDir).getRelativePathFrom(file));
  o->setProperty("pluginFormat", pd.pluginFormatName);
  o->setProperty("categoryRaw", pd.category);
  o->setProperty("category", normalizeCategory(pd));
  o->setProperty("isInstrument", pd.isInstrument);
  o->setProperty("manufacturer", pd.manufacturerName);
  o->setProperty("version", pd.version);
  o->setProperty("uid", juce::String(pd.uniqueId));
  o->setProperty("lastFileModTime", pd.lastFileModTime.toMilliseconds());
  return juce::var(o.get());
}

juce::var scanRoot(const juce::String& rootPath, juce::AudioPluginFormatManager& fm) {
  juce::DynamicObject::Ptr root = new juce::DynamicObject();
  root->setProperty("rootPath", rootPath);
  root->setProperty("rootName", juce::File(rootPath).getFileName());

  juce::Array<juce::var> files;

  const juce::File rootDir(rootPath);
  if (!rootDir.exists() || !rootDir.isDirectory()) {
    root->setProperty("files", juce::var(files));
    root->setProperty("error", "Directory not found or not a directory");
    return juce::var(root.get());
  }

  juce::KnownPluginList knownList;
  const auto deadMansPedal = juce::File::getSpecialLocation(juce::File::tempDirectory)
      .getChildFile("sls-vst-host-deadmanspedal.txt");

  for (int i = 0; i < fm.getNumFormats(); ++i) {
    auto* format = fm.getFormat(i);
    if (!format) continue;

    juce::PluginDirectoryScanner scanner(
        knownList,
        *format,
        juce::FileSearchPath(rootDir.getFullPathName()),
        true,
        deadMansPedal,
        true);

    juce::String pluginName;
    while (scanner.scanNextFile(true, pluginName)) {}
  }

  const auto types = knownList.getTypes();
  for (const auto& pd : types) files.add(pluginToVar(pd, rootPath));

  root->setProperty("files", juce::var(files));
  return juce::var(root.get());
}

juce::var resEnvelope(const juce::String& op, const juce::String& id, bool ok, const juce::var& data, const juce::String& code = {}, const juce::String& message = {}) {
  juce::DynamicObject::Ptr out = new juce::DynamicObject();
  out->setProperty("v", 1);
  out->setProperty("type", "res");
  out->setProperty("op", op);
  out->setProperty("id", id);
  out->setProperty("ts", nowMs());
  out->setProperty("ok", ok);
  if (ok) {
    out->setProperty("data", data);
  } else {
    juce::DynamicObject::Ptr err = new juce::DynamicObject();
    err->setProperty("code", code);
    err->setProperty("message", message);
    out->setProperty("err", juce::var(err.get()));
  }
  return juce::var(out.get());
}

struct PluginWindow final : public juce::DocumentWindow {
  PluginWindow(const juce::String& title, juce::AudioProcessorEditor* editor)
      : juce::DocumentWindow(title, juce::Colours::black, juce::DocumentWindow::allButtons) {
    setUsingNativeTitleBar(true);
    setContentOwned(editor, true);
    centreWithSize(juce::jmax(480, editor->getWidth()), juce::jmax(320, editor->getHeight()));
    setResizable(true, false);
    setAlwaysOnTop(true);
    setVisible(true);
    toFront(true);
  }

  void closeButtonPressed() override {
    setVisible(false);
  }
};

struct HostedInstance {
  std::unique_ptr<juce::AudioPluginInstance> plugin;
  std::unique_ptr<PluginWindow> window;
  juce::PluginDescription desc;
  juce::MidiBuffer pendingMidi;
  juce::AudioBuffer<float> scratch;
  double sampleRate = 48000.0;
  int blockSize = 512;
};

class VstRuntimeHost {
 public:
  explicit VstRuntimeHost(juce::AudioPluginFormatManager& formatManager) : fm(formatManager) {}

  juce::var handleReq(const juce::var& req) {
    const auto* o = req.getDynamicObject();
    if (!o) return resEnvelope("unknown", "0", false, {}, "E_BAD_ENVELOPE", "Invalid request object");

    const auto op = getStringProp(o, "op", "unknown");
    const auto id = getStringProp(o, "id", "0");
    const auto type = getStringProp(o, "type", "");
    if (type != "req") return resEnvelope(op, id, false, {}, "E_BAD_ENVELOPE", "type must be req");

    auto dataVar = o->getProperty("data");
    auto* d = dataVar.getDynamicObject();

    if (op == "vst.host.hello") return opHello(op, id);
    if (op == "vst.scan") return opScan(op, id, d);
    if (op == "vst.inst.ensure" || op == "vst.instantiate") return opEnsure(op, id, d);
    if (op == "vst.inst.param.set") return opParamSet(op, id, d);
    if (op == "vst.note.on") return opNote(op, id, d, true);
    if (op == "vst.note.off") return opNote(op, id, d, false);
    if (op == "vst.ui.open") return opUiOpen(op, id, d);
    if (op == "vst.release") return opRelease(op, id, d);

    return resEnvelope(op, id, false, {}, "E_UNKNOWN_OP", "Unknown opcode");
  }

 private:
  juce::AudioPluginFormatManager& fm;
  std::unordered_map<std::string, std::unique_ptr<HostedInstance>> instances;

  juce::PluginDescription findDescriptionForPath(const juce::String& pluginPath) {
    for (int i = 0; i < fm.getNumFormats(); ++i) {
      auto* format = fm.getFormat(i);
      if (!format) continue;
      juce::OwnedArray<juce::PluginDescription> types;
      format->findAllTypesForFile(types, pluginPath);
      if (types.size() > 0 && types[0] != nullptr) return *types[0];
    }
    juce::PluginDescription fallback;
    fallback.fileOrIdentifier = pluginPath;
    fallback.pluginFormatName = "VST3";
    fallback.name = juce::File(pluginPath).getFileNameWithoutExtension();
    return fallback;
  }

  HostedInstance* ensureInstance(const juce::String& instId, const juce::String& pluginPath, juce::String& errOut) {
    const auto key = instId.toStdString();
    if (auto it = instances.find(key); it != instances.end()) return it->second.get();

    auto desc = findDescriptionForPath(pluginPath);
    if (desc.fileOrIdentifier.isEmpty()) {
      errOut = "Plugin description not found";
      return nullptr;
    }

    auto plugin = std::unique_ptr<juce::AudioPluginInstance>(fm.createPluginInstance(desc, 48000.0, 512, errOut));
    if (!plugin) return nullptr;

    auto state = std::make_unique<HostedInstance>();
    state->desc = desc;
    state->plugin = std::move(plugin);
    state->sampleRate = 48000.0;
    state->blockSize = 512;
    state->scratch.setSize(juce::jmax(2, state->plugin->getTotalNumOutputChannels()), state->blockSize);
    state->plugin->prepareToPlay(state->sampleRate, state->blockSize);

    auto* out = state.get();
    instances.emplace(key, std::move(state));
    return out;
  }

  void renderOneBlock(HostedInstance& state) {
    state.scratch.clear();
    state.plugin->processBlock(state.scratch, state.pendingMidi);
    state.pendingMidi.clear();
  }

  juce::var opHello(const juce::String& op, const juce::String& id) {
    juce::DynamicObject::Ptr caps = new juce::DynamicObject();
    caps->setProperty("vstScan", true);
    caps->setProperty("vst3", true);
    caps->setProperty("vstRuntime", true);
    caps->setProperty("vstUi", true);

    juce::DynamicObject::Ptr data = new juce::DynamicObject();
    data->setProperty("protocol", "SLS-VST-HOST/1.1");
    data->setProperty("name", "sls-vst-host");
    data->setProperty("instances", (int)instances.size());
    data->setProperty("capabilities", juce::var(caps.get()));
    return resEnvelope(op, id, true, juce::var(data.get()));
  }

  juce::var opScan(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    juce::Array<juce::String> dirs = getStringArrayProp(d, "directories");
    juce::Array<juce::var> roots;
    for (const auto& dir : dirs) roots.add(scanRoot(dir, fm));
    juce::DynamicObject::Ptr data = new juce::DynamicObject();
    data->setProperty("roots", juce::var(roots));
    return resEnvelope(op, id, true, juce::var(data.get()));
  }

  juce::var opEnsure(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    const auto pluginPath = getStringProp(d, "pluginPath", "").trim();
    if (pluginPath.isEmpty()) return resEnvelope(op, id, false, {}, "E_BAD_REQUEST", "pluginPath required");
    auto instId = getStringProp(d, "instId", "").trim();
    if (instId.isEmpty()) instId = pluginPath;

    juce::String err;
    auto* state = ensureInstance(instId, pluginPath, err);
    if (!state) return resEnvelope(op, id, false, {}, "E_INSTANTIATE", err.isNotEmpty() ? err : "Unable to instantiate plugin");

    juce::DynamicObject::Ptr data = new juce::DynamicObject();
    data->setProperty("hosted", true);
    data->setProperty("instId", instId);
    data->setProperty("pluginPath", pluginPath);
    data->setProperty("pluginName", state->desc.name);
    data->setProperty("isInstrument", state->desc.isInstrument);
    return resEnvelope(op, id, true, juce::var(data.get()));
  }

  juce::var opParamSet(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    const auto pluginPath = getStringProp(d, "pluginPath", "").trim();
    if (pluginPath.isEmpty()) return resEnvelope(op, id, false, {}, "E_BAD_REQUEST", "pluginPath required");
    auto instId = getStringProp(d, "instId", "").trim();
    if (instId.isEmpty()) instId = pluginPath;

    juce::String err;
    auto* state = ensureInstance(instId, pluginPath, err);
    if (!state) return resEnvelope(op, id, false, {}, "E_INSTANTIATE", err.isNotEmpty() ? err : "Unable to instantiate plugin");

    juce::DynamicObject::Ptr data = new juce::DynamicObject();
    data->setProperty("hosted", true);
    data->setProperty("instId", instId);
    data->setProperty("applied", false);
    data->setProperty("note", "Generic param mapping not implemented yet");
    return resEnvelope(op, id, true, juce::var(data.get()));
  }

  juce::var opNote(const juce::String& op, const juce::String& id, const juce::DynamicObject* d, bool isOn) {
    const auto pluginPath = getStringProp(d, "pluginPath", "").trim();
    if (pluginPath.isEmpty()) return resEnvelope(op, id, false, {}, "E_BAD_REQUEST", "pluginPath required");
    auto instId = getStringProp(d, "instId", "").trim();
    if (instId.isEmpty()) instId = pluginPath;

    juce::String err;
    auto* state = ensureInstance(instId, pluginPath, err);
    if (!state) return resEnvelope(op, id, false, {}, "E_INSTANTIATE", err.isNotEmpty() ? err : "Unable to instantiate plugin");

    const int note = juce::jlimit(0, 127, getStringProp(d, "note", "60").getIntValue());
    const float vel = juce::jlimit(0.0f, 1.0f, (float)getStringProp(d, "vel", "0.85").getDoubleValue());
    if (isOn) state->pendingMidi.addEvent(juce::MidiMessage::noteOn(1, note, vel), 0);
    else state->pendingMidi.addEvent(juce::MidiMessage::noteOff(1, note), 0);

    renderOneBlock(*state);

    juce::DynamicObject::Ptr data = new juce::DynamicObject();
    data->setProperty("hosted", true);
    data->setProperty("instId", instId);
    data->setProperty("rendered", true);
    return resEnvelope(op, id, true, juce::var(data.get()));
  }

  juce::var opUiOpen(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    const auto pluginPath = getStringProp(d, "pluginPath", "").trim();
    if (pluginPath.isEmpty()) return resEnvelope(op, id, false, {}, "E_BAD_REQUEST", "pluginPath required");
    auto instId = getStringProp(d, "instId", "").trim();
    if (instId.isEmpty()) instId = pluginPath;

    juce::String err;
    auto* state = ensureInstance(instId, pluginPath, err);
    if (!state) return resEnvelope(op, id, false, {}, "E_INSTANTIATE", err.isNotEmpty() ? err : "Unable to instantiate plugin");

    if (!state->plugin->hasEditor()) {
      juce::DynamicObject::Ptr data = new juce::DynamicObject();
      data->setProperty("hosted", true);
      data->setProperty("opened", false);
      data->setProperty("instId", instId);
      data->setProperty("reason", "Plugin has no editor");
      return resEnvelope(op, id, true, juce::var(data.get()));
    }

    if (!state->window) {
      auto* editor = state->plugin->createEditorIfNeeded();
      if (editor == nullptr) return resEnvelope(op, id, false, {}, "E_UI_CREATE", "Failed to create editor");
      state->window = std::make_unique<PluginWindow>(state->desc.name, editor);
    } else {
      state->window->setVisible(true);
      state->window->toFront(true);
    }

    juce::DynamicObject::Ptr data = new juce::DynamicObject();
    data->setProperty("hosted", true);
    data->setProperty("opened", true);
    data->setProperty("instId", instId);
    return resEnvelope(op, id, true, juce::var(data.get()));
  }

  juce::var opRelease(const juce::String& op, const juce::String& id, const juce::DynamicObject* d) {
    auto instId = getStringProp(d, "instId", "").trim();
    auto pluginPath = getStringProp(d, "pluginPath", "").trim();
    if (instId.isEmpty()) instId = pluginPath;
    if (instId.isEmpty()) return resEnvelope(op, id, false, {}, "E_BAD_REQUEST", "instId or pluginPath required");

    if (auto it = instances.find(instId.toStdString()); it != instances.end()) {
      if (it->second->window) it->second->window->setVisible(false);
      it->second->plugin->releaseResources();
      instances.erase(it);
    }

    juce::DynamicObject::Ptr data = new juce::DynamicObject();
    data->setProperty("released", true);
    data->setProperty("instId", instId);
    data->setProperty("instances", (int)instances.size());
    return resEnvelope(op, id, true, juce::var(data.get()));
  }
};

} // namespace

int main() {
  juce::ScopedJuceInitialiser_GUI juceInit;
  juce::AudioPluginFormatManager formatManager;
  formatManager.addFormat(new juce::VST3PluginFormat());
  VstRuntimeHost host(formatManager);

  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;

    juce::var in;
    const auto parseResult = juce::JSON::parse(juce::String(line), in);
    if (parseResult.failed()) {
      auto out = resEnvelope("unknown", "0", false, {}, "E_BAD_JSON", parseResult.getErrorMessage());
      std::cout << juce::JSON::toString(out, false).toStdString() << "\n";
      continue;
    }

    auto out = host.handleReq(in);
    std::cout << juce::JSON::toString(out, false).toStdString() << "\n";
    std::cout.flush();
    if (auto* mm = juce::MessageManager::getInstanceWithoutCreating(); mm != nullptr) mm->runDispatchLoopUntil(2);
  }

  return 0;
}
