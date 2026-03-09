#include "instruments/ViolinInstrument.h"
namespace sls::inst {
InstrumentState ViolinInstrument::makeDefaultState() const {
    InstrumentState st;
    st.type = "violin";
    st.gain = 1.0f;
    st.attack = 0.02f;
    st.decay = 0.08f;
    st.sustain = 0.85f;
    st.release = 0.28f;
    st.waveform = 2;
    st.polyphony = 10;
    st.cutoffHz = 9000.0f;
    st.resonance = 1.2f;
    st.detuneCents = 6.0f;
    st.vibratoRateHz = 5.5f;
    st.vibratoDepthCents = 8.0f;
    st.extra.set("bowNoise", 0.12f);
    return st;
}
} // namespace sls::inst
