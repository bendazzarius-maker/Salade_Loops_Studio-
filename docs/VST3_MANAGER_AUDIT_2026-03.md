# Audit — Pipeline VST3 complet (SL Studio)

## Résumé exécutif
Le pipeline VST3 est partiellement câblé côté UI (scan, bibliothèque, boutons d'ouverture), mais **non opérationnel** pour l'hébergement runtime (instanciation audio + UI flottante) tant que le binaire `sls-vst-host` n'implémente pas les opcodes runtime (`vst.inst.ensure`, `vst.note.on/off`, `vst.ui.open`).

Dans l'état initial:
- Le moteur audio JUCE (`sls-audio-engine`) expose des opcodes VST, mais retourne explicitement `E_NOT_SUPPORTED`.
- L'UI appelait uniquement ce moteur pour `vst.ui.open`, donc le bouton d'UI VST échouait systématiquement.
- Les instruments VST du piano roll tombaient en fallback instrument natif.

## Causes racines identifiées
1. **Backend VST runtime absent dans le moteur audio principal**:
   - `vst.inst.ensure`, `vst.inst.param.set`, `vst.note.on`, `vst.note.off`, `vst.ui.open` sont stubbés en `E_NOT_SUPPORTED`.
2. **Capability explicite désactivée**:
   - `capabilities.vstHost = false` dans `engine.hello`.
3. **Binaire VST dédié limité au scan**:
   - `sls-vst-host` gère `vst.host.hello` et `vst.scan`, mais pas l'instanciation/lecture/UI.
4. **Chemin UI bouton VST trop strict (avant correctif)**:
   - la logique bloquait sur `vstHost=false` du moteur JUCE, sans tenter le host dédié.

## Correctifs appliqués dans ce patch
### 1) Bridge IPC Electron vers `sls-vst-host` généralisé
- Ajout de:
  - `vst:hostHello`
  - `vst:hostRequest`

### 2) Exposition preload du bridge runtime VST
- Ajout de:
  - `window.vstFS.hostHello()`
  - `window.vstFS.hostRequest(op, data, timeoutMs)`

### 3) UI VST (bouton "Ouvrir interface VST")
- La fonction `openVstUi()` tente désormais:
  1) `sls-vst-host` via `vst.ui.open`
  2) fallback sur moteur JUCE (compatibilité)
- Ajout d'un audit détaillé asynchrone `auditPipelineDetailed()` pour diagnostiquer `hostHello`.

### 4) Runtime instruments VST piano roll
- Le driver instrument tente désormais les opcodes VST via host dédié en priorité, puis fallback JUCE.
- Si non supporté, fallback natif conservé (comportement robuste, pas de crash).

## État actuel après audit
### Fonctionnel
- Scan VST3 + classification + librairie UI.
- Routage IPC vers host dédié prêt pour extension runtime.
- Boutons UI VST passent par la bonne couche d'abstraction (host dédié prioritaire).

### Encore bloquant pour "VST3 full support"
- `sls-vst-host` n'implémente pas encore:
  - `vst.instantiate`/`vst.inst.ensure`
  - `vst.release`
  - `vst.note.on`, `vst.note.off`
  - `vst.inst.param.set`
  - `vst.ui.open` (fenêtre flottante / editor natif)
- Sans ces opcodes, instruments VST ne peuvent pas réellement jouer dans le piano roll.

## Plan recommandé (prochain patch)
1. Implémenter un host long-vivant (process persistant) côté `Main/Juce-Cpp/vst/`.
2. Ajouter un registry d'instances (`instId -> AudioPluginInstance`) + routing MIDI/audio.
3. Implémenter une fenêtre editor dédiée par instance (UI flottante).
4. Ajouter opcodes runtime ci-dessus + gestion de cycle de vie.
5. Ajouter tests d'intégration IPC:
   - instantiate -> note.on/off -> audio activity
   - ui.open -> opened=true
   - release -> cleanup

## Conclusion
Le problème signalé est confirmé: la UI VST et les instruments VST ne sont pas réellement opérationnels à cause d'un backend runtime incomplet.
Le patch prépare la bonne architecture de communication (host dédié prioritaire) et fiabilise le diagnostic, mais le support VST3 complet nécessite l'implémentation runtime dans `sls-vst-host`.
