#include "AudioScheduler.h"
#include <algorithm>
#include <cmath>

void AudioScheduler::prepare(double sampleRate, int stepsPerBeat) {
  mSampleRate = sampleRate > 1.0 ? sampleRate : 44100.0;
  mStepsPerBeat = stepsPerBeat > 0 ? stepsPerBeat : 16;
}

void AudioScheduler::reset() {
  mSamplePos = 0;
  mPlaying = false;
  mTimeline.clear();
}

void AudioScheduler::setTransport(double bpm, int64_t samplePos, bool playing) {
  mBpm = bpm > 1.0 ? bpm : 120.0;
  mSamplePos = std::max<int64_t>(0, samplePos);
  mPlaying = playing;
}

void AudioScheduler::setTimeline(const std::vector<ScheduledEvent>& timeline) {
  mTimeline = timeline;
  std::stable_sort(mTimeline.begin(), mTimeline.end(), [](const ScheduledEvent& a, const ScheduledEvent& b) {
    return a.atPpq < b.atPpq;
  });
}

double AudioScheduler::samplePosToPpq(int64_t samplePos) const {
  const double seconds = static_cast<double>(samplePos) / std::max(1.0, mSampleRate);
  return seconds * (mBpm / 60.0);
}

std::vector<BlockEvent> AudioScheduler::collectBlockEvents(int numFrames) const {
  std::vector<BlockEvent> out;
  if (!mPlaying || numFrames <= 0 || mTimeline.empty())
    return out;

  const double blockStartPpq = samplePosToPpq(mSamplePos);
  const double blockEndPpq = samplePosToPpq(mSamplePos + numFrames);
  const double ppqSpan = std::max(1e-9, blockEndPpq - blockStartPpq);

  for (const auto& ev : mTimeline) {
    if (ev.atPpq < blockStartPpq || ev.atPpq >= blockEndPpq)
      continue;

    const double norm = (ev.atPpq - blockStartPpq) / ppqSpan;
    BlockEvent be;
    be.offset = juce::jlimit(0, std::max(0, numFrames - 1), static_cast<int>(std::floor(norm * numFrames)));
    be.ev = ev;
    out.push_back(std::move(be));
  }

  std::stable_sort(out.begin(), out.end(), [](const BlockEvent& a, const BlockEvent& b) {
    return a.offset < b.offset;
  });
  return out;
}

void AudioScheduler::advance(int numFrames) {
  mSamplePos += std::max(0, numFrames);
}
