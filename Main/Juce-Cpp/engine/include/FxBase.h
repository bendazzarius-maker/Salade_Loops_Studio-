#pragma once
#include <string>
#include <cstdint>

/*
  FxBase
  ======
  Minimal DSP unit interface for Salad Loops Studio JUCE engine.

  IMPORTANT:
  - setParam is called on the control thread (IPC), never from the audio thread.
  - process is called on the audio thread, must be realtime-safe (no allocations, no locks).
*/

class FxBase {
public:
  virtual ~FxBase() = default;

  virtual const char* type() const = 0;

  virtual void prepare(double sampleRate, int maxBlockSize, int numChannels) = 0;

  // Set numeric param by name (control thread).
  virtual void setParam(const std::string& name, float value) = 0;

  virtual void setBypass(bool bypass) { mBypass = bypass; }
  bool isBypassed() const { return mBypass; }

  // Process in place (N channels)
  virtual void process(float** chans, int numChannels, int numFrames,
                       double bpm, int64_t samplePos, bool playing) = 0;

protected:
  bool mBypass = false;
};
