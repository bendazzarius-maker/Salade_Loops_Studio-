# sls-audio-engine (JUCE)

## Build

```bash
cmake -S Main/Juce-Cpp/engine -B Main/Juce-Cpp/engine/build -G Ninja
cmake --build Main/Juce-Cpp/engine/build -j
```

Post-build copies executable to:
- `Main/native/sls-audio-engine` (Linux)
- `Main/native/sls-audio-engine.exe` (Windows)

## How to test (CLI)

```bash
echo '{"v":1,"type":"req","op":"engine.hello","id":"t1","ts":0,"data":{}}' | Main/native/sls-audio-engine | head -n 1
```

```bash
{ \
  echo '{"v":1,"type":"req","op":"mixer.init","id":"m1","ts":0,"data":{"channels":16}}'; \
  echo '{"v":1,"type":"req","op":"inst.create","id":"i1","ts":0,"data":{"instId":"bass-1","type":"bass","ch":0}}'; \
  echo '{"v":1,"type":"req","op":"transport.play","id":"p1","ts":0,"data":{}}'; \
  echo '{"v":1,"type":"req","op":"note.on","id":"n1","ts":0,"data":{"instId":"bass-1","note":48,"vel":0.9}}'; \
  sleep 1; \
  echo '{"v":1,"type":"req","op":"note.off","id":"n2","ts":0,"data":{"instId":"bass-1","note":48}}'; \
  sleep 1; \
} | Main/native/sls-audio-engine
```

## How to test (Electron)

```bash
cd Main
npm start
```

Verify in logs that backend active is `juce` and audio responds to transport/instrument actions.


## VST bridge backend status

Le moteur JUCE accepte désormais les opérations backend suivantes pour faire le pont avec la bibliothèque VST du front:

- `vst.inst.ensure`
- `vst.inst.param.set`
- `vst.note.on`
- `vst.note.off`
- `vst.ui.open`

Ces opérations sont actuellement branchées sur une **couche runtime backend (stub)** qui valide et stocke l'état des instances/plugins, puis renvoie des réponses `ok`.
La sortie UI est exposée via l'événement `vst.ui.state`.

> Note: l'hébergement natif VST (chargement DSP réel + fenêtre plugin native) reste l'étape suivante.
