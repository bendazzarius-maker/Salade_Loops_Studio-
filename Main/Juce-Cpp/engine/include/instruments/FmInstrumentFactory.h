#pragma once

#include <memory>
#include <string>
#include "FmInstrumentBase.h"

namespace sls::engine {

class FmInstrumentFactory {
public:
    static std::unique_ptr<FmInstrumentBase> create(const std::string& typeId);
};

} // namespace sls::engine
