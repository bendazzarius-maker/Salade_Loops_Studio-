# Audit technique JUCE audio engine (RT, stabilité, routing FX)

## Portée
Audit centré sur le moteur JUCE C++ actuel (`Main/Juce-Cpp/engine/src/main.cpp`) et l’état de la refactorisation (`FxBase/FxChain/FxDelay/MixerEngine`).

---

## 1) Flux audio actuel (constaté)

### 1.1 Chemin de traitement exact
1. Callback JUCE `audioDeviceIOCallbackWithContext` prend `audioMutex` puis efface les sorties.
2. Gestion transport (play armed / play).
3. Préparation événements scheduler (`prepareBlockEvents`) si `playing`.
4. Boucle **sample par sample**:
   - Déclenche événements planifiés (`dispatchOneEvent`) au sample offset.
   - Render voix sampler puis synth -> accumulation par canal dans `busL/busR`.
   - Pour chaque canal:
     - EQ canal (`ChannelDSP::processEq`).
     - FX chain canal (`processFxChain(channelDsp[ch].fx, ...)`).
     - gain/pan/mètres.
     - routage vers bus A, B ou OFF (`xAssign`).
   - Somme master:
     - OFF toujours ajouté.
     - A/B mixés par `masterCross` (equal-power cos/sin).
   - EQ master puis FX master puis master gain.
   - Cas `!anyAB` : application `crossfader` en pseudo-pan stéréo (hérité).
   - Écriture sortie stéréo + compteurs meters.
5. Fin de bloc: avance `samplePos`, RMS, reset accums.

### 1.2 Stockage états DSP / mixer
- États mixer par canal: `mixerStates` (gain/pan/eq/mute/solo/xAssign).
- DSP canal: `channelDsp` (6 filtres IIR + `fx` vector).
- DSP master: `masterDsp` + `masterFx`.
- Delay actuel **dans main.cpp**: buffers globaux `delayBufferL/R` + index et états damp dans `FxUnit`.

### 1.3 Refactor en cours (non branché au flux principal)
- `FxBase`, `FxChain`, `FxDelay`, `MixerEngine` existent mais sont des squelettes / implémentations partielles.
- Le callback audio principal n’utilise pas encore `MixerEngine`/`FxChain` pour son flux réel.

---

## 2) Audit threading / concurrence

## 2.1 Verrous observés
- `audioMutex`: pris dans callback audio + handlers IPC mixer/fx + refresh EQ.
- `stateMutex`: scheduler, seek, project sync.
- `ioMutex`: écriture stdout JSON.

## 2.2 Risques critiques

### P0 — Self-deadlock réentrant sur `audioMutex`
- `handleMixerParamSet` prend `audioMutex` puis appelle `refreshEqForChannel` qui **reprend** `audioMutex`.
- `refreshMasterEq` prend aussi `audioMutex` et peut être appelé depuis sections déjà lockées.
- `std::mutex` n’est pas récursif -> blocage dur possible => timeouts IPC + moteur muet.

### P0 — Lock bloquant dans le callback audio
- Callback tient `audioMutex` pendant tout le bloc sample-by-sample.
- Toute commande IPC `mixer.*` / `fx.*` attend ce lock (latence IPC élevée).
- Si un handler long tient `audioMutex`, le thread audio peut rater deadline => glitch/XRUN.

### P1 — Data races hors lock
- `handleMixerCompatMaster` et `handleMixerCompatChannel` modifient `masterGain/masterEq/.../mixerStates` sans lock uniforme alors que callback lit en continu.
- `meterData` (thread state) lit/reset compteurs meters pendant que callback écrit -> race.
- `sampleCache` modifié depuis IPC (`sampler.unload/load`) alors que callback peut lire via `triggerSampleFromObject` (route scheduler/audio) selon timing.

### P1 — Mutation structurelle FX sous lock audio unique
- `fx.chain.set` fait `clear/push_back/new/delete` sur vector FX sous `audioMutex`.
- Fonctionnel mais non scalable: contention forte + fragmentation, risque de blocage si opérations lourdes.

---

## 3) Audit granularité / zipper noise

Paramètres sensibles actuellement appliqués en steps:
- `masterGain`, `crossfader/masterCross`, `pan`, gains canal.
- Coefficients EQ: recalcul et `reset()` des filtres à chaque update.
- Delay params (`wet/feedback/time/division`) appliqués sans ramp.

Causes probables:
1. Pas de smoothing per-sample/per-block sur gains/cross/pan.
2. EQ reset instantané en lecture (discontinuité d’état IIR).
3. Delay time variant sans interpolation => modulation brutale de read index.

Corrections RT-safe recommandées:
- `juce::SmoothedValue<float>` par paramètre audio-sensible (master + canal + fx instance).
- Pour EQ: ne pas `reset()` à chaque changement; faire interpolation de coefficients (ou crossfade entre deux filtres) et swap atomique des `CoefficientsPtr`.
- Delay: lisser `wet`, `feedback`, `timeSec`; clamp strict + “slew limiter” sur `delaySamp`.

---

## 4) Audit FX Delay multi-instance & routing

Constat:
- `FxUnit` est bien par instance (id/type/params + `unique_ptr<FxBase>`).
- Mapping target est `master` ou `channel[ch]` via `resolveFxTarget`.
- MAIS implémentation delay active dans `processFxChain` (main.cpp) utilise **buffers globaux partagés** `delayBufferL/R`.
- Donc 2 delays de canaux différents partagent mémoire de retard -> crosstalk/état contaminé, impression “1 seul marche”.

Correctif prioritaire:
- Supprimer chemin delay legacy de `main.cpp`.
- Obliger `FxUnit::dsp = FxDelay` pour chaque instance et process via `FxBase::process` (buffers internes par instance).
- Garder la clé d’instance `(target scope + ch + fxId)` stable; `fx.param.set` ne doit agir que sur cette entrée.

---

## 5) Audit contrat IPC et causes de timeout

Le handler `handle()` répond vite en général (`resOk/resErr` systématique), mais timeouts possibles si:
1. Deadlock `audioMutex` (cf. P0).
2. Contention extrême callback↔IPC sur `audioMutex`.
3. Thread audio bloqué par callback trop long (boucle sample + locks + conversions).

Actions:
- Découpler application commandes IPC du lock audio global.
- Introduire file SPSC lock-free des commandes DSP appliquées au début de callback.
- Conserver compat opcodes actuelle (`mixer.init`, `mixer.channel.set`, `mixer.master.set`, `mixer.param.set`, `fx.*`, `transport.*`, `schedule.*`, `meter.*`, `sampler.*`).

---

## 6) Proposition RT-safe (prioritaire)

## Option retenue (recommandée): **SPSC command queue + snapshots atomiques**

- Thread IPC:
  - Parse JSON.
  - Validation légère.
  - Push commande POD dans `AbstractFifo`/ring SPSC (no lock).
  - Répond `resOk` immédiatement si enqueue ok; sinon `resErr E_BUSY`.
- Thread audio (début callback):
  - Drain queue bornée (max N commandes/bloc).
  - Applique:
    - paramètres scalaires -> atomiques/smoothed targets.
    - mutations structurelles FX -> sur copie “next graph”, puis swap pointeur atomique en fin de drain.

Pseudo-code:

```cpp
struct RtCommand {
  enum Type { SetMasterParam, SetChannelParam, SetFxParam, SetFxChain, SetTempo, ... } type;
  int ch;
  int fxSlot;
  char key[24];
  float value;
  FxChainPayload chain; // index stable + ids
};

// IPC thread
bool ok = cmdQueue.push(cmd);
if (ok) resOk(...); else resErr(..., "E_BUSY", ...);

// audio thread - start of callback
int budget = 256;
while (budget-- > 0 && cmdQueue.pop(cmd)) {
  switch(cmd.type) {
    case SetMasterParam: masterParams.setTarget(cmd.key, cmd.value); break;
    case SetChannelParam: channelParams[cmd.ch].setTarget(cmd.key, cmd.value); break;
    case SetFxParam: fxGraph.next.applyParam(cmd); needSwap = true; break;
    case SetFxChain: fxGraph.next.rebuildChain(cmd); needSwap = true; break;
  }
}
if (needSwap) fxGraph.atomicSwap();
```

---

## 7) Plan de refactor incrémental (sans casser compat)

### P2.1 — Stabilisation immédiate (hotfix)
1. Éliminer deadlocks `audioMutex` (pas de lock imbriqué).
2. Uniformiser accès mixer/master/meter avec stratégie thread-safe minimale.
3. Ajouter garde-fous NaN/Inf sur master out + delay.
4. Conserver opcodes inchangés.

### P2.2 — Param smoothing
1. Introduire `SmoothedValue` pour master gain/cross + gain/pan canal + wet/fb/time delay.
2. Remplacer updates “hard step” dans callback.
3. Conserver valeurs UI exactes (target) + ramp courte (5–20ms).

### P2.3 — Routing FX multi-instance robuste
1. Basculer delay legacy vers `FxDelay` instance-unique.
2. Clé stable `(scope,ch,fxId)`; tests 2 delays / 2 canaux.
3. Préallocation `prepare` à `audioDeviceAboutToStart` / `mixer.init`.

### P2.4 — Command queue RT-safe
1. Ajouter file SPSC de commandes.
2. Déplacer toute mutation structurelle hors lock callback global.
3. Supprimer `audioMutex` long-held dans process audio.

### P2.5 — Migration architecture
- `main.cpp`: bootstrap device + IPC decode + dispatch commandes.
- `MixerEngine.(h/cpp)`: rendu audio complet, routing, smoothing, meters.
- `FxChain.(h/cpp)`: gestion d’instances FX par target.
- `FxDelay.(h/cpp)`: delay prod prêt RT.

---

## 8) Instrumentation minimale utile

1. **Compteurs atomiques**: xruns estimés, queue overflow, commandes drop.
2. **Watchdog audio**: timestamp dernier callback + alerte si > 200ms.
3. **NaN guard**: compteur `nanSanitizedSamples` + reset fx instance fautive.
4. **Logs throttlés** (1/s max):
   - `E_BUSY queue full`
   - `FX instance missing target/fxId`
   - `audio callback overrun`.

Aucun log depuis boucle sample (RT); uniquement compteurs + émission côté thread état.

---

## 9) Check-list validation reproductible

1. **Routing multi-instance**
   - Channel 1: delay fxId=d1 (time=1/8, wet=0.2)
   - Channel 2: delay fxId=d2 (time=1/4, wet=0.6)
   - Vérifier indépendance totale (pas de fuite inter-canaux).
2. **Crossfader en lecture**
   - Balayer A->B en 2s en continu; absence de clicks.
3. **EQ master + EQ channel en lecture**
   - Sweep -12/+12 dB, zéro zipper noise audible.
4. **Add/remove FX en lecture**
   - `fx.chain.set` puis `fx.param.set` rapide, pas de timeout IPC.
5. **Tempo change en lecture**
   - 90->140 BPM, delay sync reste stable sans pop.
6. **Stress 2 minutes**
   - automation crossfader + EQ + fx params + sampler.trigger.
   - attendu: 0 crash, 0 mute, 0 timeout.

---

## 10) Priorisation causes probables

### Crash / SIGSEGV / mute (ordre)
1. Deadlock `audioMutex` réentrant via refresh EQ (P0).
2. Race sur structures shared non uniformément lockées (mixer compat, meters, sample cache) (P1).
3. Contention excessive audioMutex => callback starvation/timeouts (P1).
4. États numériques invalides non monitorés (NaN propagation) (P2).

### Granularité / zipper (ordre)
1. Absence smoothing gain/cross/pan (P0 audible).
2. EQ coefficient reset brutal (P0 audible).
3. Delay time/feedback non lissés (P1 audible).

---

## Conclusion opérationnelle
Le correctif le plus sûr avant ajout de nouveaux FX:
1) supprimer deadlocks/locks imbriqués, 2) introduire smoothing systématique, 3) isoler delay par instance (plus de buffer global), 4) passer commandes IPC via queue RT-safe.

Ces étapes stabilisent crash + moteur muet + granularité, tout en gardant le contrat IPC et le routing A/B/OFF + piste C/OFF bus intacts.
