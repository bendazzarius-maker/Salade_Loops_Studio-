#pragma once

#include <array>
#include <string>
#include "FmAlgorithm.h"
#include "FmOperator.h"

namespace sls::engine::fm {

struct FmVoiceParams {
    int algorithm = 0;
    float masterGain = 0.25f;
    float stereoWidth = 0.0f;
    float lfoRateHz = 0.0f;
    float lfoDepth = 0.0f;
};

struct FmPatch {
    std::string name;
    FmVoiceParams voice;
    std::array<FmOperatorParams, kMaxFmOperators> operators {};
    std::array<double, kMaxFmOperators> attack { 0.01, 0.01, 0.01, 0.01, 0.01, 0.01 };
    std::array<double, kMaxFmOperators> decay  { 0.15, 0.15, 0.15, 0.15, 0.15, 0.15 };
    std::array<float,  kMaxFmOperators> sustain{ 0.7f, 0.7f, 0.7f, 0.7f, 0.7f, 0.7f };
    std::array<double, kMaxFmOperators> release{ 0.2, 0.2, 0.2, 0.2, 0.2, 0.2 };
};

} // namespace sls::engine::fm
