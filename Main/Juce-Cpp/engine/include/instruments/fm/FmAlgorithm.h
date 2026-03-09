#pragma once

#include <array>
#include <cstddef>

namespace sls::engine::fm {

constexpr std::size_t kMaxFmOperators = 6;

struct FmAlgorithmNode {
    std::array<int, 4> modulators { -1, -1, -1, -1 };
    bool isCarrier = false;
};

struct FmAlgorithm {
    std::array<FmAlgorithmNode, kMaxFmOperators> nodes {};
    int carrierCount = 0;
};

class FmAlgorithms {
public:
    static const FmAlgorithm& byIndex(int index);
    static const FmAlgorithm& dxStyleStack();
    static const FmAlgorithm& dxStyleElectricPiano();
    static const FmAlgorithm& dxStyleBass();
};

} // namespace sls::engine::fm
