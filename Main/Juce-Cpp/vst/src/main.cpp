#include <filesystem>
#include <iostream>

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_core/juce_core.h>

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
        rootDir,
        true,
        deadMansPedal,
        true);

    juce::String pluginName;
    while (scanner.scanNextFile(true, pluginName)) {}
  }

  juce::Array<juce::PluginDescription> types;
  knownList.getTypes(types);
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

juce::var handleReq(const juce::var& req, juce::AudioPluginFormatManager& fm) {
  const auto* o = req.getDynamicObject();
  if (!o) return resEnvelope("unknown", "0", false, {}, "E_BAD_ENVELOPE", "Invalid request object");

  const auto op = getStringProp(o, "op", "unknown");
  const auto id = getStringProp(o, "id", "0");
  const auto type = getStringProp(o, "type", "");
  if (type != "req") return resEnvelope(op, id, false, {}, "E_BAD_ENVELOPE", "type must be req");

  auto dataVar = o->getProperty("data");
  auto* d = dataVar.getDynamicObject();

  if (op == "vst.host.hello") {
    juce::DynamicObject::Ptr caps = new juce::DynamicObject();
    caps->setProperty("vstScan", true);
    caps->setProperty("vst3", true);

    juce::DynamicObject::Ptr data = new juce::DynamicObject();
    data->setProperty("protocol", "SLS-VST-HOST/1.0");
    data->setProperty("name", "sls-vst-host");
    data->setProperty("capabilities", juce::var(caps.get()));
    return resEnvelope(op, id, true, juce::var(data.get()));
  }

  if (op == "vst.scan") {
    juce::Array<juce::String> dirs = getStringArrayProp(d, "directories");
    juce::Array<juce::var> roots;

    for (const auto& dir : dirs) roots.add(scanRoot(dir, fm));

    juce::DynamicObject::Ptr data = new juce::DynamicObject();
    data->setProperty("roots", juce::var(roots));
    return resEnvelope(op, id, true, juce::var(data.get()));
  }

  return resEnvelope(op, id, false, {}, "E_UNKNOWN_OP", "Unknown opcode");
}

} // namespace

int main() {
  juce::ScopedJuceInitialiser_GUI juceInit;
  juce::AudioPluginFormatManager formatManager;
  formatManager.addDefaultFormats();

  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;

    juce::var in;
    juce::String err;
    in = juce::JSON::parse(juce::String(line), err);
    if (err.isNotEmpty()) {
      auto out = resEnvelope("unknown", "0", false, {}, "E_BAD_JSON", err);
      std::cout << juce::JSON::toString(out, false).toStdString() << "\n";
      continue;
    }

    auto out = handleReq(in, formatManager);
    std::cout << juce::JSON::toString(out, false).toStdString() << "\n";
    std::cout.flush();
  }

  return 0;
}
