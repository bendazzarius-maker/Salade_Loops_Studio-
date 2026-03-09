#include "instruments/fm/FmAlgorithm.h"

namespace sls::engine::fm {

namespace {
const FmAlgorithm kStack = [] {
    FmAlgorithm a;
    a.nodes[0].isCarrier = true;
    a.nodes[0].modulators = { 1, -1, -1, -1 };
    a.nodes[1].modulators = { 2, -1, -1, -1 };
    a.nodes[2].modulators = { 3, -1, -1, -1 };
    a.nodes[3].modulators = { 4, -1, -1, -1 };
    a.nodes[4].modulators = { 5, -1, -1, -1 };
    a.carrierCount = 1;
    return a;
}();

const FmAlgorithm kElectricPiano = [] {
    FmAlgorithm a;
    a.nodes[0].isCarrier = true; a.nodes[0].modulators = { 1, -1, -1, -1 };
    a.nodes[2].isCarrier = true; a.nodes[2].modulators = { 3, -1, -1, -1 };
    a.nodes[4].isCarrier = true; a.nodes[4].modulators = { 5, -1, -1, -1 };
    a.carrierCount = 3;
    return a;
}();

const FmAlgorithm kBass = [] {
    FmAlgorithm a;
    a.nodes[0].isCarrier = true; a.nodes[0].modulators = { 1, 2, -1, -1 };
    a.nodes[3].isCarrier = true; a.nodes[3].modulators = { 4, -1, -1, -1 };
    a.nodes[5].isCarrier = false;
    a.carrierCount = 2;
    return a;
}();
}

const FmAlgorithm& FmAlgorithms::byIndex(int index) {
    switch (index) {
        case 1: return kElectricPiano;
        case 2: return kBass;
        default: return kStack;
    }
}

const FmAlgorithm& FmAlgorithms::dxStyleStack() { return kStack; }
const FmAlgorithm& FmAlgorithms::dxStyleElectricPiano() { return kElectricPiano; }
const FmAlgorithm& FmAlgorithms::dxStyleBass() { return kBass; }

} // namespace sls::engine::fm
