#include "instruments/SubBassInstrument.h"
namespace sls::inst {
InstrumentState SubBassInstrument::makeDefaultState() const {
    InstrumentState st;
    st.type = "subbass";
    st.gain = 1.0f;
    st.attack = 0.003f;
    st.decay = 0.08f;
    st.sustain = 0.70f;
    st.release = 0.14f;
    st.waveform = 3;
    st.polyphony = 10;
    st.cutoffHz = 550.0f;
    st.resonance = 0.9f;
    st.drive = 0.15f;
    return st;
}
} // namespace sls::inst
