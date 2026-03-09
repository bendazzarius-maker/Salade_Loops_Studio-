#include "instruments/PadInstrument.h"
namespace sls::inst {
InstrumentState PadInstrument::makeDefaultState() const {
    InstrumentState st;
    st.type = "pad";
    st.gain = 1.0f;
    st.attack = 0.25f;
    st.decay = 0.40f;
    st.sustain = 0.80f;
    st.release = 1.20f;
    st.waveform = 2;
    st.polyphony = 14;
    st.cutoffHz = 9000.0f;
    st.resonance = 0.9f;
    st.detuneCents = 10.0f;
    st.extra.set("lfoRate", 0.12f);
    st.extra.set("lfoDepth", 0.35f);
    return st;
}
} // namespace sls::inst
