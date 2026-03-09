#include "instruments/LeadInstrument.h"
namespace sls::inst {
InstrumentState LeadInstrument::makeDefaultState() const {
    InstrumentState st;
    st.type = "lead";
    st.gain = 1.0f;
    st.attack = 0.003f;
    st.decay = 0.10f;
    st.sustain = 0.65f;
    st.release = 0.14f;
    st.waveform = 2;
    st.polyphony = 12;
    st.cutoffHz = 12000.0f;
    st.resonance = 1.2f;
    st.detuneCents = 6.0f;
    st.vibratoRateHz = 0.0f;
    st.vibratoDepthCents = 0.0f;
    st.extra.set("glide", 0.0f);
    return st;
}
} // namespace sls::inst
