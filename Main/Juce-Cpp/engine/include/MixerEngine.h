// Skeleton files generated for Salad Loops Studio JUCE engine modularization.
// Generated: 2026-03-03
// NOTE: main.cpp is intentionally NOT included (already exists).
// These files are placeholders with TODOs and interface notes.

#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include <unordered_map>

/*
  MixerEngine
  ===========
  Goal:
  - Centralize all mixer-side audio logic in JUCE backend (C++).
  - JS remains UI-only and pushes state via IPC ops (mixer.* + fx.* + lfo.*).
  Responsibilities:
  - Per-channel: gain, pan, mute, solo
  - Per-channel EQ: eqLow, eqMid, eqHigh (and optional master EQ)
  - Crossfader: A/B/OFF assignment per channel + master cross value
  - Routing: build Bus A / Bus B / Bus OFF sums, apply crossfade and master gain/pan
  - FX chain hosting per channel (delegated to FxChain / FxUnits)
  - Provide an API for "applyMixerParam" called from IPC handlers in main.cpp
  - Provide per-block processing entry point used by audio callback.

  Notes:
  - Keep audio-thread safe: lock-free param updates (atomic / smoothing).
  - Avoid allocations in process().
*/

enum class XAssign : uint8_t { A = 0, B = 1, OFF = 2 };

struct MixerChannelParams {
  float gain = 1.0f;
  float pan  = 0.0f;     // -1..+1
  bool mute  = false;
  bool solo  = false;

  float eqLow  = 0.0f;   // dB or normalized; define convention
  float eqMid  = 0.0f;
  float eqHigh = 0.0f;

  XAssign xAssign = XAssign::OFF;
};

struct MixerMasterParams {
  float gain = 1.0f;
  float pan  = 0.0f;     // -1..+1
  float cross = 0.5f;    // 0..1 (A..B). Define "center = 0.5"
  // Optional master EQ
  float eqLow  = 0.0f;
  float eqMid  = 0.0f;
  float eqHigh = 0.0f;
};

class FxChain; // fwd

class MixerEngine {
public:
  MixerEngine();
  ~MixerEngine();

  // Call once from main.cpp during engine init
  void prepare(double sampleRate, int maxBlockSize, int numChannelsOut, int numMixerChannels);

  // IPC-driven parameter updates (called from message thread / IPC thread)
  // Implement with lock-free strategy; these functions must NOT touch audio buffers.
  void setMasterParam(const std::string& param, float value);
  void setChannelParam(int ch, const std::string& param, float value);
  void setChannelXAssign(int ch, XAssign assign);

  // FX chain control (called from IPC handlers)
  void setFxChain(int ch, const std::vector<std::string>& fxTypesOrdered);
  void setFxParam(int ch, int fxIndex, const std::string& param, float value);
  void setFxBypass(int ch, int fxIndex, bool bypass);

  // Audio processing entry point (called from audio thread)
  // Input: per-channel stems (already rendered instruments/samplers per mixer channel)
  // Output: stereo master out buffer
  void process(float** channelInputs, int numMixerChannels, float** masterOutStereo, int numFrames);

  // Transport context (for tempo-synced FX/LFO)
  void setTransport(double bpm, int64_t samplePos, bool playing);

private:
  double mSampleRate = 44100.0;
  int mMaxBlockSize = 512;
  int mNumOutCh = 2;
  int mNumMixerCh = 0;

  MixerMasterParams mMaster;
  std::vector<MixerChannelParams> mCh;

  // Crossfade / routing state
  // TODO: implement smoothing and equal-power crossfade if desired.

  // FX chains per channel
  std::vector<FxChain*> mFx; // owned elsewhere or own with unique_ptr in cpp

  // Transport
  double mBpm = 120.0;
  int64_t mSamplePos = 0;
  bool mPlaying = false;

  // TODO: internal helpers
  float applyPanL(float x, float pan) const;
  float applyPanR(float x, float pan) const;
};
