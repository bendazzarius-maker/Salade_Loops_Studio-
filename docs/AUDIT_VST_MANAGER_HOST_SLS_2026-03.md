# Audit complet — VST Manager, Host VST, SLS Audio Engine, Piano Roll, UI VST

Date: 2026-03

## 1) Constat principal (cause racine)

Le blocage observé (« scan VST ne fonctionne plus », tri FX/Instrument/Inconnu instable, UI plugin indisponible par moments) vient d'une **architecture en 2 étages**:

1. **Scan + runtime VST**: assurés en priorité par le binaire dédié `sls-vst-host` (Electron main process).
2. **Moteur audio SLS JUCE**: garde `vstHost=false` et renvoie `E_NOT_SUPPORTED` pour les opcodes VST natifs dans ce build.

➡️ En pratique: si `sls-vst-host` est absent/injoignable, le front bascule sur un scan fallback (extensions + heuristiques nom), ce qui augmente fortement les plugins « unknown » et peut casser le comportement attendu du tri.

---

## 2) Vérification scan VST + tri FX/Instrument/Inconnu

### Pipeline de scan
- L'UI déclenche `vstFS.scanDirectories()` depuis `vstManager.js`.
- Electron route vers `ipcMain("vst:scanDirectories")`.
- Electron tente d'abord `requestVstHost("vst.scan")`.
- Si échec, fallback scanner local basé sur extensions (`.vst3/.dll/.so/.component`) + heuristique de nom.

### Point critique tri/classification
- Le tri en UI dépend de `classify(plugin)` côté `vstManager.js`.
- Avant correction, la classification utilisait surtout `plugin.category` strict (`fx|instrument|unknown`), donc beaucoup de plugins pouvaient rester en `unknown` si les métadonnées revenaient incomplètes.

### Correctif appliqué dans cet audit
- Classification renforcée dans `vstManager.js`:
  - prise en compte de `isInstrument`, `categoryRaw`, `pluginFormat`;
  - fallback heuristique sur `name + path` pour mieux répartir FX vs instruments;
  - maintien du mode manuel via override utilisateur.

Effet attendu:
- diminution des plugins mal classés en « inconnu »;
- tri plus robuste même si certaines métadonnées host sont partielles.

---

## 3) Compatibilité Host VST ↔ moteur `sls-audio-engine`

### État réel constaté
- Le moteur JUCE principal expose explicitement `capabilities.vstHost = false`.
- Les opcodes VST (`vst.inst.ensure`, `vst.note.on/off`, `vst.ui.open`, etc.) renvoient `E_NOT_SUPPORTED` dans ce build moteur.
- La compatibilité VST est donc assurée **par le host dédié `sls-vst-host`**, pas par le moteur principal.

### Conséquence
- Le fonctionnement VST dépend de la disponibilité du binaire `Main/native/sls-vst-host` (ou `resources/native` en packaging).
- Si ce binaire manque (ou timeout), le scan passe fallback et la partie runtime/UI VST se dégrade.

---

## 4) Compatibilité avec le gestionnaire instrument / piano roll

- `bank.js` détecte les presets `VSTI::...` et route en priorité vers `vstFS.hostRequest(...)`.
- Si le backend VST n'est pas utilisable, fallback automatique vers instrument natif (piano/bass/etc.) avec toast d'information.
- Donc: le piano roll reste fonctionnel, mais peut piloter un fallback natif au lieu du vrai VST quand le host n'est pas disponible.

---

## 5) Affichage interface des VST (plugin editor)

- L'ouverture d'UI passe par `openVstUi()` côté `vstManager.js`.
- Priorité: `vstFS.hostRequest("vst.ui.open")`, puis fallback vers backend JUCE si possible.
- Comme le moteur principal n'active pas le VST host, l'UI plugin dépend majoritairement du host dédié.

---

## 6) Améliorations techniques livrées dans ce patch

1. **Classification robuste** des plugins en scan/tri (`vstManager.js`).
2. **Retour de statut explicite** de `scan()` (au lieu d'un retour silencieux), utile pour diagnostiquer les échecs réels.
3. **Audit détaillé enrichi** via `auditPipelineDetailed()` avec un `scanProbe` pour valider le chemin de scan actif.

---

## 7) Plan d'actions recommandé (priorité)

1. Vérifier au lancement la présence/exécution de `sls-vst-host` et afficher une alerte claire si indisponible.
2. Exposer dans l'UI la source de scan active (`sls-vst-host` vs `fallback`) pour éviter les faux diagnostics.
3. Ajouter un indicateur de santé runtime VST (hello + ping + version host).
4. À moyen terme: soit activer `vstHost` dans le moteur principal, soit assumer officiellement l'architecture dual-host et centraliser les erreurs utilisateur.

