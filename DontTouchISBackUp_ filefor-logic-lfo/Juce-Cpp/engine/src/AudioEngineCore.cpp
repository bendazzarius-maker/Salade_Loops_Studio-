#include "AudioEngineCore.h"

AudioEngineCore::AudioEngineCore() = default;
AudioEngineCore::~AudioEngineCore() = default;

void AudioEngineCore::prepare(double sampleRate, int maxBlockSize, int numOutChannels, int numMixerChannels) {
  mSampleRate = sampleRate;
  mMaxBlockSize = maxBlockSize;
  mNumOutChannels = numOutChannels;
  mNumMixerChannels = numMixerChannels;

  mMixer.prepare(sampleRate, maxBlockSize, numOutChannels, numMixerChannels);
  mPresetLfo.prepare(sampleRate);
  mCurveLfo.prepare(sampleRate);
  mScheduler.prepare(sampleRate);
}

void AudioEngineCore::reset() {
  mScheduler.reset();
  setTransport(120.0, 0, false);
}

void AudioEngineCore::setTransport(double bpm, int64_t samplePos, bool playing) {
  mMixer.setTransport(bpm, samplePos, playing);
  mPresetLfo.setTransport(bpm, samplePos, playing);
  mCurveLfo.setTransport(bpm, samplePos, playing);
  mScheduler.setTransport(bpm, samplePos, playing);
}

void AudioEngineCore::setTimeline(const std::vector<ScheduledEvent>& timeline) {
  mScheduler.setTimeline(timeline);
}

void AudioEngineCore::process(float** channelInputs, int numMixerChannels, float** masterOutStereo, int numFrames) {
  // Scheduler ownership stays here so main.cpp no longer has to advance transport,
  // mod sources and routing separately.
  (void)mScheduler.collectBlockEvents(numFrames); // hook point for voice triggering.
  mMixer.process(channelInputs, numMixerChannels, masterOutStereo, numFrames);
  mPresetLfo.advance(numFrames);
  mCurveLfo.advance(numFrames);
  mScheduler.advance(numFrames);
  setTransport(mScheduler.bpm(), mScheduler.samplePos(), mScheduler.playing());
}
