# Audit — Intégration VST3 Manager (SL Studio)

## Ce qui est en place dans ce patch
- Nouvel onglet UI `VST Manager` dans l'app Electron (`Main/index.html`).
- Choix de dossiers VST + scan récursif via IPC main process (`vst:pickDirectories`, `vst:scanDirectories`).
- Classement initial en 3 groupes:
  - `FX`
  - `Instrument`
  - `Non classé`
- Nouveau module JUCE parallèle: `Main/Juce-Cpp/vst/` (indépendant de `engine/`).

## Limite actuelle (important)
Le classement actuel dans l'UI est **heuristique** (basé sur le nom du fichier plugin).
C'est utile pour démarrer, mais ce n'est pas fiable à 100%.

## Méthode correcte pour FX vs Instrument
Pour classifier correctement, il faut charger/inspecter le plugin via JUCE:
- `juce::AudioPluginFormatManager`
- `juce::KnownPluginList`
- `juce::PluginDescription`

Puis utiliser les infos natives du plugin (`plugin category`, `isInstrument`, etc.)
au lieu d'inférer depuis le nom.

## Architecture proposée
1. Garder `engine/` orienté audio runtime DAW.
2. Ajouter un binaire/service dédié `sls-vst-host` dans `Main/Juce-Cpp/vst`.
3. Exposer IPC:
   - `vst.scan`
   - `vst.instantiate`
   - `vst.release`
4. Router résultats:
   - Instrument -> bibliothèque instruments du Piano Roll
   - FX -> bibliothèque FX du Mixer

## Compatibilité build
Le dossier `Main/Juce-Cpp/vst/` est prévu pour compiler dans le même environnement JUCE,
mais séparément d'`engine` (build parallèle/indépendant).
