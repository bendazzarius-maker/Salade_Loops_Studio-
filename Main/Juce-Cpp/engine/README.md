# sls-audio-engine (JUCE)

## Build

### Linux/macOS

```bash
cmake -S Main/Juce-Cpp/engine -B Main/Juce-Cpp/engine/build
cmake --build Main/Juce-Cpp/engine/build -j
```

### Windows (MSVC)

```powershell
cmake -S Main/Juce-Cpp/engine -B Main/Juce-Cpp/engine/build -G "Visual Studio 17 2022" -A x64
cmake --build Main/Juce-Cpp/engine/build --config Release
```

Post-build copies the executable automatically to:

- `Main/native/sls-audio-engine` (Linux/macOS)
- `Main/native/sls-audio-engine.exe` (Windows)
