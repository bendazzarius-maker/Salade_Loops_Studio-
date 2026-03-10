# Audit — Pipeline VST3 complet (SL Studio)

## Résumé exécutif
Le pipeline VST3 est désormais câblé de bout en bout avec un **runtime implémenté dans `sls-vst-host`** et un **bridge IPC persistant** côté Electron.

Concrètement:
- Les opcodes runtime sont maintenant pris en charge par le host VST dédié (`vst.inst.ensure`, `vst.inst.param.set`, `vst.note.on`, `vst.note.off`, `vst.ui.open`, `vst.release`).
- Le process `sls-vst-host` est maintenu vivant dans Electron (au lieu d'un spawn one-shot par requête), ce qui permet de conserver l'état des instances plugins.
- Les boutons UI VST et le chemin instrument VST piano roll passent par ce host en priorité.

## Causes racines (avant correctif)
1. Le moteur JUCE principal renvoyait `E_NOT_SUPPORTED` pour les opcodes VST runtime.
2. Le host VST dédié n'implémentait initialement que le scan.
3. Le bridge main process exécutait le host en mode one-shot, empêchant toute persistance d'instances.

## Correctifs implémentés

### 1) Runtime VST implémenté dans `Main/Juce-Cpp/vst/src/main.cpp`
- Ajout d'un gestionnaire d'instances plugin en mémoire (`instId -> AudioPluginInstance`).
- Implémentation des opcodes:
  - `vst.inst.ensure` / `vst.instantiate`
  - `vst.inst.param.set`
  - `vst.note.on`
  - `vst.note.off`
  - `vst.ui.open` (fenêtre flottante via `DocumentWindow`)
  - `vst.release`
- `vst.host.hello` expose désormais des capabilities runtime (`vstRuntime`, `vstUi`).

### 2) Bridge IPC persistant dans `Main/main.js`
- Passage d'un modèle spawn-per-request à un process `sls-vst-host` persistant.
- Routage par `id` de requête avec table `pending` + timeout.
- Nettoyage propre à l'arrêt de l'application.

### 3) Renderer bridge + usage UI/runtime
- `preload.js` expose `vstFS.hostHello()` et `vstFS.hostRequest()`.
- `vstManager.js` ouvre l'UI plugin via host dédié en priorité.
- `bank.js` route les opcodes runtime instrument VST vers le host dédié en priorité.

## État actuel
### Fonctionnel
- Scan VST3 + classification.
- Instanciation runtime persistante.
- Ouverture de fenêtre UI plugin (si editor disponible).
- Note on/off dispatché au plugin.

### Limites connues
- Le mapping générique des paramètres JS DAW vers les paramètres natifs plugin n'est pas finalisé (`vst.inst.param.set` retourne `applied=false`).
- Le rendu audio est déclenché par blocs internes runtime pour faire vivre l'instance plugin, mais l'intégration complète de mixage multi-instance avec routage avancé reste à étendre.

## Prochaines étapes recommandées
1. Mapping robuste des paramètres plugin (ID/index, automation).
2. Cycle audio continu par instance (si nécessaire selon plugin) et supervision CPU.
3. Gestion multi-instance avancée (bus, sidechain, offline render).
4. Persist project state VST (preset/chunk).
