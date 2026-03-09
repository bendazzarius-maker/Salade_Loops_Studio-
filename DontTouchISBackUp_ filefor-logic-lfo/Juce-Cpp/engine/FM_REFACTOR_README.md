FM refactor patch for SLS engine
================================

Purpose
-------
This patch adds a DX7-inspired FM synthesis layer so instruments stop depending on a single primitive voice in main.cpp.

Included
--------
- Core FM engine primitives:
  - FmEnvelope
  - FmOperator
  - FmAlgorithm
  - FmPatch
  - FmVoice
  - FmEngine
- FM instrument layer:
  - FmInstrumentBase
  - FmInstrumentFactory
  - DxPianoInstrument
  - RhodesFmInstrument

What this patch is
------------------
A clean compile-oriented skeleton to integrate into your existing JUCE engine. It is intentionally conservative:
- no hard dependency on the current monolithic InstrumentState in main.cpp
- no forced rewrite of scheduling or mixer code
- no change to current IPC protocol yet

Recommended next integration steps
----------------------------------
1. Add the .cpp files listed in CMakeLists.fm_patch.txt into engine/CMakeLists.txt.
2. In main.cpp, replace the current generic synth defaults for piano/rhodes with a type-to-patch lookup through FmInstrumentFactory.
3. Create a runtime wrapper (for example InstrumentRuntime / VoiceEngine) that owns one FmEngine per instrument instance.
4. Route inst.param.set values like fm, attack, decay, sustain, release into patch macros instead of the generic Voice struct.
5. Keep main.cpp as orchestration only; do not expand it further.

Suggested mapping from current JS presets
-----------------------------------------
Current WebAudio piano presets already expose useful macro controls:
- attack
- decay
- sustain
- release
- fm
- tremRate
- tremDepth

Those can become macro transforms over FmPatch rather than raw oscillator parameters.

Notes
-----
- The algorithms are DX-style inspired, not exact hardware clones.
- The Rhodes FM patch is meant to capture tine/bell/body behavior, not to claim perfect electromechanical Rhodes emulation.
- This patch is the right foundation to later add Bass FM, Bell FM, Pad FM, and Drum FM percussion voices.
