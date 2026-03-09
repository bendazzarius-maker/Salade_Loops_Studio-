#include "instruments/BassInstrument.h"
namespace sls::inst {
InstrumentState BassInstrument::makeDefaultState() const {
    InstrumentState st;
    st.type = "bass";
    st.gain = 1.0f;
    st.attack = 0.003f;
    st.decay = 0.09f;
    st.sustain = 0.70f;
    st.release = 0.14f;
    st.waveform = 1;
    st.polyphony = 12;
    st.cutoffHz = 900.0f;
    st.resonance = 1.4f;
    st.drive = 0.20f;
    st.subLevel = 0.65f;
    return st;
}
} // namespace sls::inst
