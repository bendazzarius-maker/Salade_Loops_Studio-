#include "instruments/fm/FmAlgorithm.h"

namespace sls::engine::fm {

namespace {
const FmAlgorithm kAlgo1Stack = [] {
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

const FmAlgorithm kAlgo2ThreeStacks = [] {
    FmAlgorithm a;
    a.nodes[0].isCarrier = true; a.nodes[0].modulators = { 1, -1, -1, -1 };
    a.nodes[2].isCarrier = true; a.nodes[2].modulators = { 3, -1, -1, -1 };
    a.nodes[4].isCarrier = true; a.nodes[4].modulators = { 5, -1, -1, -1 };
    a.carrierCount = 3;
    return a;
}();

const FmAlgorithm kAlgo3DualCarrier = [] {
    FmAlgorithm a;
    a.nodes[0].isCarrier = true; a.nodes[0].modulators = { 1, 2, -1, -1 };
    a.nodes[3].isCarrier = true; a.nodes[3].modulators = { 4, -1, -1, -1 };
    a.nodes[5].isCarrier = false;
    a.carrierCount = 2;
    return a;
}();

const FmAlgorithm kAlgo4Parallel = [] {
    FmAlgorithm a;
    a.nodes[0].isCarrier = true;
    a.nodes[0].modulators = { 1, -1, -1, -1 };
    a.nodes[2].isCarrier = true;
    a.nodes[2].modulators = { 3, 4, -1, -1 };
    a.nodes[5].isCarrier = true;
    a.carrierCount = 3;
    return a;
}();

const FmAlgorithm kAlgo5Wide = [] {
    FmAlgorithm a;
    a.nodes[0].isCarrier = true;
    a.nodes[0].modulators = { 1, 2, -1, -1 };
    a.nodes[3].isCarrier = true;
    a.nodes[3].modulators = { 4, 5, -1, -1 };
    a.carrierCount = 2;
    return a;
}();

const FmAlgorithm kAlgo6NoisySplit = [] {
    FmAlgorithm a;
    a.nodes[0].isCarrier = true;
    a.nodes[0].modulators = { 1, -1, -1, -1 };
    a.nodes[2].isCarrier = true;
    a.nodes[2].modulators = { 3, -1, -1, -1 };
    a.nodes[4].isCarrier = true;
    a.nodes[4].modulators = { 5, -1, -1, -1 };
    a.carrierCount = 3;
    return a;
}();

const FmAlgorithm kAlgo7CrossMod = [] {
    FmAlgorithm a;
    a.nodes[0].isCarrier = true;
    a.nodes[0].modulators = { 1, 2, -1, -1 };
    a.nodes[1].modulators = { 3, -1, -1, -1 };
    a.nodes[2].modulators = { 4, -1, -1, -1 };
    a.nodes[5].isCarrier = true;
    a.carrierCount = 2;
    return a;
}();

const FmAlgorithm kAlgo8AllCarriers = [] {
    FmAlgorithm a;
    for (auto& n : a.nodes) n.isCarrier = true;
    a.carrierCount = static_cast<int>(a.nodes.size());
    return a;
}();
}

const FmAlgorithm& FmAlgorithms::byIndex(int index) {
    switch (index) {
        case 1: return kAlgo2ThreeStacks;
        case 2: return kAlgo3DualCarrier;
        case 3: return kAlgo4Parallel;
        case 4: return kAlgo5Wide;
        case 5: return kAlgo6NoisySplit;
        case 6: return kAlgo7CrossMod;
        case 7: return kAlgo8AllCarriers;
        default: return kAlgo1Stack;
    }
}

const FmAlgorithm& FmAlgorithms::dxStyleStack() { return kAlgo1Stack; }
const FmAlgorithm& FmAlgorithms::dxStyleElectricPiano() { return kAlgo2ThreeStacks; }
const FmAlgorithm& FmAlgorithms::dxStyleBass() { return kAlgo3DualCarrier; }

} // namespace sls::engine::fm
