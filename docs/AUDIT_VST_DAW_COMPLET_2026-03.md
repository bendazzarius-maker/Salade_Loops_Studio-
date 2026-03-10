# Audit complet — Gestion VST Instruments + FX (SL Studio)

## Contexte du problème signalé
Symptôme remonté : lorsqu'un instrument VST est sélectionné dans la bibliothèque du piano roll, le son reste un instrument générique (piano DAW), et l'interface VST ne s'ouvre pas dans un conteneur dédié.

## Résultat global
Le pipeline VST est partiellement implémenté (scan, bibliothèque, sélection, opcodes runtime, bouton d'ouverture UI), mais **pas encore 100% fonctionnel** pour une expérience DAW complète instrument+FX :

- ✅ Scan VST (host dédié + fallback scan fichiers)
- ✅ Bibliothèque VST (instruments/FX) exposée au renderer
- ✅ Sélection VST dans le channel/piano roll
- ✅ Runtime d'instance VST instrument (ensure/note on/off) côté host VST
- ⚠️ Paramètres VST génériques non mappés (applied=false)
- ⚠️ UI VST ouverte en fenêtre native externe (DocumentWindow), pas dans un conteneur UI intégré Electron/DAW
- ⚠️ Intégration audio VST FX dans le moteur temps réel principal non branchée

## Diagnostic détaillé par couche

### 1) Couche UI (renderer)
- Le sélecteur d'instrument du piano roll inclut bien les entrées VST via `window.vstLibrary.getInstrumentChoices()` avec des valeurs `VSTI::...`.
- Le panneau instrument propose un bouton **"🧩 Ouvrir interface VST"** pour les presets VST.
- Correctif appliqué dans cet audit: détection des presets VST déplacée avant la résolution des presets natifs pour éviter l'état "Instrument introuvable" et l'impression de fallback systématique.

### 2) Couche bridge Electron (preload + main)
- `preload.js` expose `vstFS.pickDirectories`, `scanDirectories`, `hostHello`, `hostRequest`.
- `main.js` maintient un process `sls-vst-host` persistant (stdin/stdout JSON) avec gestion de pending/timeouts.
- Si le binaire host n'est pas disponible, scan fallback sur extensions de fichier seulement (classification heuristique).

### 3) Couche runtime VST host (`sls-vst-host`)
- Opérations implémentées :
  - `vst.host.hello`
  - `vst.scan`
  - `vst.inst.ensure`
  - `vst.inst.param.set`
  - `vst.note.on` / `vst.note.off`
  - `vst.ui.open`
  - `vst.release`
- Les instances plugin sont persistées en mémoire (`instId -> HostedInstance`).
- L'ouverture d'UI est gérée via `juce::DocumentWindow` native.

### 4) Couche moteur audio JUCE principal
- Le README du moteur confirme que les opcodes VST côté engine principal répondent `E_NOT_SUPPORTED` dans ce build.
- Le runtime VST est donc externalisé vers `sls-vst-host` et ne passe pas dans le graphe mixage/FX principal de manière unifiée.

## Causes probables du comportement observé
1. **UI panel VST bloqué avant patch**
   - Le panneau instrument tentait d'abord de résoudre un preset natif (`presets.def`) puis retournait "Instrument introuvable" avant d'entrer dans le chemin VST.
2. **Fallback audio natif volontaire**
   - Si `vst.inst.ensure` / `vst.inst.param.set` ne remontent pas `hosted=true`, le code bascule sur un instrument natif (souvent piano), ce qui correspond exactement au symptôme utilisateur.
3. **Capacités host non vérifiées en amont UX**
   - L'état `vst.host.hello` n'est pas utilisé pour verrouiller/alerter l'UX avant sélection, donc l'utilisateur peut choisir un VST alors que le backend n'est pas réellement prêt.
4. **FX VST non intégrés au moteur audio principal**
   - Le mixer accepte des entrées `VSTFX::...` et un bouton UI, mais la chaîne audio FX réelle est pilotée par `fx.chain.set/fx.param.set` sur modules natifs.

## Écarts restants pour atteindre "100% fonctionnel"

### A. Chargement instrument VST fiable
- [ ] Ajouter un **état explicite par channel** : `vstLoaded`, `vstHosted`, `lastVstError`.
- [ ] Bloquer le fallback silencieux vers piano (ou l'afficher explicitement dans UI).
- [ ] Vérifier `vst.host.hello` au boot et afficher un diagnostic global (binaire absent, capacités manquantes, etc.).

### B. UI VST intégrée DAW
- [ ] Décider de l'architecture :
  - Fenêtre native flottante (actuel), ou
  - embedding dans une sous-fenêtre Electron/JS dédiée.
- [ ] Si objectif "conteneur dédié dans le DAW", implémenter un pont natif pour hoster l'éditeur dans une vue intégrée (work important selon OS + JUCE).

### C. Paramètres VST/automation
- [ ] Implémenter un mapping robuste `vst.inst.param.set` (ID/index param, normalisation 0..1, texte/enum).
- [ ] Exposer découverte des paramètres plugin (nom, min/max, default).
- [ ] Brancher automation lane -> paramètres VST.

### D. VST FX audio réel
- [ ] Définir opcodes FX dédiés (`vst.fx.ensure`, `vst.fx.param.set`, `vst.fx.process` ou intégration directe graphe engine).
- [ ] Router audio channel/master vers instances FX VST dans le moteur RT.
- [ ] Gérer latence compensation, ordre de chaîne, bypass, preset/chunk state.

### E. Persistance projet
- [ ] Sauvegarder/restaurer état VST par projet (plugin path, state chunk, params, UI state).
- [ ] Validation à l'ouverture : plugin manquant, substitution, bypass safe.

## Plan d'exécution recommandé (ordre)
1. Stabiliser l'UX de disponibilité host + erreurs explicites (court terme).
2. Finaliser chargement instrument VST sans fallback silencieux.
3. Implémenter paramètres/automation instruments VST.
4. Intégrer VST FX dans le graphe audio principal.
5. Finaliser persistance complète projet + tests de non-régression.

## Correctif appliqué pendant cet audit
- Correctif `Main/instrumentPanel.js` pour traiter les presets VST **avant** la résolution du preset natif, et afficher correctement la section VST + routing au lieu de retourner prématurément sur "Instrument introuvable".
