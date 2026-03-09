#pragma once
#include <cstdint>
#include <vector>
#include <juce_core/juce_core.h>

/*
  AudioScheduler
  ==============
  Extracts transport + block scheduling responsibilities out of main.cpp.
  It is intentionally generic: the caller owns the actual synth/sampler voice
  rendering, while this class computes which events fall inside the current block.
*/

struct ScheduledEvent {
  double atPpq = 0.0;
  juce::String type;
  juce::String instId;
  int mixCh = 1;
  int note = 60;
  float vel = 0.85f;
  double durPpq = 0.25;
  juce::var payload;
};

struct BlockEvent {
  int offset = 0; // [0..numFrames)
  ScheduledEvent ev;
};

class AudioScheduler {
public:
  void prepare(double sampleRate, int stepsPerBeat = 16);
  void reset();

  void setTransport(double bpm, int64_t samplePos, bool playing);
  void setTimeline(const std::vector<ScheduledEvent>& timeline);

  std::vector<BlockEvent> collectBlockEvents(int numFrames) const;
  void advance(int numFrames);

  double bpm() const noexcept { return mBpm; }
  int64_t samplePos() const noexcept { return mSamplePos; }
  bool playing() const noexcept { return mPlaying; }

private:
  double samplePosToPpq(int64_t samplePos) const;

  double mSampleRate = 44100.0;
  int mStepsPerBeat = 16;
  double mBpm = 120.0;
  int64_t mSamplePos = 0;
  bool mPlaying = false;
  std::vector<ScheduledEvent> mTimeline;
};
