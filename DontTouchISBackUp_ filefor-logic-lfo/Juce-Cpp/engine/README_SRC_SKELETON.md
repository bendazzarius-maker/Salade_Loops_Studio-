# JUCE Engine SRC Skeleton (placeholders)

Generated: 2026-03-03

This archive contains a starter modular C++ structure for the JUCE audio engine **excluding** `main.cpp`.
You asked for empty/placeholder files with comments describing responsibilities:

- MixerEngine (mixer logic: EQ, crossfader A/B/OFF, channel handling, routing, FX hosting)
- LfoPresetEngine (preset LFO module)
- LfoCurveEngine (curve/Bezier LFO module)
- ModMatrix (routes LFO sources to mixer params and FX params)
- Fx framework: FxBase, FxChain, FxFactory
- Individual FX units: Delay, Chorus, Flanger, Compressor, GrossBeat, Reverb

## Where to place
Copy `engine/include/*.h` and `engine/src/*.cpp` into your JUCE engine project (e.g. `Main/Juce-Cpp/engine/`).
Then update your `CMakeLists.txt` to compile these new sources.

## Next steps
1) Wire these classes into `main.cpp` (IPC handlers call MixerEngine/FxChain/LFO engines).
2) Implement DSP for each Fx* class.
3) Implement real-time LFO execution + ModMatrix application.
4) Implement crossfader routing A/B/OFF + mixer EQ application.

