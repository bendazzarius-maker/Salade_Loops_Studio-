#include "instruments/PianoInstrument.h"
namespace sls::inst {
InstrumentState PianoInstrument::makeDefaultState() const {
    InstrumentState st;
    st.type = "piano";
    st.gain = 1.0f;
    st.attack = 0.004f;
    st.decay = 0.14f;
    st.sustain = 0.60f;
    st.release = 0.18f;
    st.fm = 12.0f;
    st.waveform = 0;
    st.polyphony = 16;
    st.cutoffHz = 14000.0f;
    st.resonance = 0.8f;
    st.extra.set("hammer", 0.25f);
    st.extra.set("tremRate", 0.0f);
    st.extra.set("tremDepth", 0.0f);
    return st;
}
} // namespace sls::inst
