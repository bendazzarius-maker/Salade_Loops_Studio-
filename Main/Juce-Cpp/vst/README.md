# sls-vst-host (JUCE, parallèle à engine)

Ce dossier est indépendant de `engine/` et prépare l'hébergement VST3 dans le même environnement JUCE.

## Objectif
- Construire en parallèle de `engine/`.
- Scanner les plugins via JUCE `AudioPluginFormatManager` + `KnownPluginList`.
- Déterminer FX vs Instrument avec les catégories réelles du plugin (pas via nom de fichier).

## Build
```bash
cmake -S Main/Juce-Cpp/vst -B Main/Juce-Cpp/vst/build -G Ninja
cmake --build Main/Juce-Cpp/vst/build -j
```

## Étapes suivantes (audit)
1. Ajouter un binaire/IPC dédié `sls-vst-host`.
2. Exposer un appel `vst.scan` retournant métadonnées (name, manufacturer, category, isInstrument).
3. Alimenter les bibliothèques DAW:
   - FX -> Mixer FX library
   - Instrument -> PianoRoll instrument library


## IPC (stdin/stdout JSON)

Le binaire `sls-vst-host` accepte des requêtes JSON ligne par ligne.

### `vst.host.hello`
Retourne le protocole et les capacités.

### `vst.scan`
Entrée:
```json
{ "v":1, "type":"req", "op":"vst.scan", "id":"x1", "data": { "directories": ["/path/vst"] } }
```

Sortie:
- `data.roots[]` avec `rootPath`, `rootName`, `files[]`
- chaque plugin inclut notamment `name`, `path`, `manufacturer`, `pluginFormat`, `categoryRaw`, `category`, `isInstrument`

L'app Electron (`Main/main.js`) utilise ce binaire en priorité pour `vst:scanDirectories`, avec fallback sur le scan simple par extensions si le binaire n'est pas disponible.
