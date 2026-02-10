/* ================= Electro DAW | inst_drums.js ================= */
(function(){
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};

  // DrumKit synth: maps pitch-class (midi%12) to pieces.
  // DemoSeed uses: C3 kick, D3 snare, F#3 closed hat.
  // Extended mapping so the kit is usable across a whole octave.
  //
  // Pitch-class mapping (midi % 12):
  //  0 C   -> Kick
  //  1 C#  -> Kick2 (tight)
  //  2 D   -> Snare
  //  3 D#  -> Clap
  //  4 E   -> Tom Low
  //  5 F   -> Tom High
  //  6 F#  -> Hat Closed
  //  7 G   -> Hat Open
  //  8 G#  -> Ride
  //  9 A   -> Crash
  // 10 A#  -> Perc (rim / blip)
  // 11 B   -> Perc2 (cow / blip2)

  const DEF = {
    id: "Drums",
    name: "Drums",
    type: "drums",
    color: "#ff4d6d",

    defaultParams: function(){
      return {
        gain: 1.0,
        kick: 1.0,
        kick2: 0.9,
        snare: 1.0,
        clap: 0.8,
        tomL: 0.9,
        tomH: 0.85,
        hatC: 0.9,
        hatO: 0.85,
        ride: 0.6,
        crash: 0.7,
        perc: 0.6,
        perc2: 0.6
      };
    },

    uiSchema: {
      title: "Drums",
      sections: [
        { title: "Main", controls: [
          { type: "slider", key: "gain", label: "Gain", min: 0, max: 1.5, step: 0.01 }
        ]},
        { title: "Levels", controls: [
          { type: "slider", key: "kick",  label: "Kick",       min: 0, max: 2, step: 0.01 },
          { type: "slider", key: "kick2", label: "Kick2",      min: 0, max: 2, step: 0.01 },
          { type: "slider", key: "snare", label: "Snare",      min: 0, max: 2, step: 0.01 },
          { type: "slider", key: "clap",  label: "Clap",       min: 0, max: 2, step: 0.01 },
          { type: "slider", key: "tomL",  label: "Tom Low",    min: 0, max: 2, step: 0.01 },
          { type: "slider", key: "tomH",  label: "Tom High",   min: 0, max: 2, step: 0.01 },
          { type: "slider", key: "hatC",  label: "Hat Closed", min: 0, max: 2, step: 0.01 },
          { type: "slider", key: "hatO",  label: "Hat Open",   min: 0, max: 2, step: 0.01 },
          { type: "slider", key: "ride",  label: "Ride",       min: 0, max: 2, step: 0.01 },
          { type: "slider", key: "crash", label: "Crash",      min: 0, max: 2, step: 0.01 },
          { type: "slider", key: "perc",  label: "Perc",       min: 0, max: 2, step: 0.01 },
          { type: "slider", key: "perc2", label: "Perc2",      min: 0, max: 2, step: 0.01 }
        ]}
      ]
    },

    create: function(ae, paramsRef, outBus){
      const ctx = ae.ctx;
      const params = paramsRef || this.defaultParams(); // legacy ref
      const common = { id:this.id, name:this.name, type:this.type, color:this.color, uiSchema:this.uiSchema, defaultParams:this.defaultParams };

      // Prebuilt noise buffers (avoid regenerating for every hit)
      const noiseShort = makeNoiseBuffer(ctx, 0.18);
      const noiseLong  = makeNoiseBuffer(ctx, 0.80);

      function noiseSource(t0, long=false){
        const src = ctx.createBufferSource();
        src.buffer = long ? noiseLong : noiseShort;
        src.start(t0);
        return src;
      }

      function mkOut(t0, level){
        const g = ctx.createGain();
        g.gain.setValueAtTime(level, t0);
        g.connect(outBus || ae.master);
        return g;
      }

      function kick(t0, out, vel, tight=false){
        const osc = ctx.createOscillator(); osc.type = "sine";
        const click = ctx.createOscillator(); click.type="square";
        const cg = ctx.createGain();

        const base = tight ? 160 : 140;
        const endf = tight ? 62 : 50;
        osc.frequency.setValueAtTime(base, t0);
        osc.frequency.exponentialRampToValueAtTime(endf, t0 + (tight?0.055:0.08));

        const g = ctx.createGain();
        const peak = Math.max(0.0001, 1.2 * vel);
        g.gain.setValueAtTime(peak, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + (tight?0.10:0.13));

        click.frequency.setValueAtTime(1800, t0);
        cg.gain.setValueAtTime(0.15*vel, t0);
        cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.02);

        osc.connect(g);
        click.connect(cg);
        g.connect(out);
        cg.connect(out);

        osc.start(t0); click.start(t0);
        osc.stop(t0 + 0.16);
        click.stop(t0 + 0.03);
      }

      function snare(t0, out, vel){
        const src = noiseSource(t0, false);
        const hp = ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=1200;
        const bp = ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=1800; bp.Q.value=0.8;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.9*vel, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);

        src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);

        // add a small tonal body
        const tone = ctx.createOscillator(); tone.type="triangle";
        tone.frequency.setValueAtTime(180, t0);
        const tg = ctx.createGain();
        tg.gain.setValueAtTime(0.18*vel, t0);
        tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.10);

        tone.connect(tg); tg.connect(out);
        tone.start(t0); tone.stop(t0 + 0.12);

        src.stop(t0 + 0.20);
      }

      function clap(t0, out, vel){
        // 3 quick noise bursts
        const times = [0.0, 0.014, 0.028];
        for(const dt of times){
          const t = t0 + dt;
          const src = noiseSource(t, false);
          const bp = ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=2400; bp.Q.value=0.9;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.55*vel, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
          src.connect(bp); bp.connect(g); g.connect(out);
          src.stop(t + 0.09);
        }
      }

      function hatClosed(t0, out, vel){
        const src = noiseSource(t0, false);
        const bp = ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=9000; bp.Q.value=6;
        const hp = ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=7000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.35*vel, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
        src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
        src.stop(t0 + 0.08);
      }

      function hatOpen(t0, out, vel, dur){
        const src = noiseSource(t0, true);
        const bp = ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=8800; bp.Q.value=4.5;
        const hp = ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=6500;
        const g = ctx.createGain();
        const rel = Math.max(0.12, Math.min(0.6, dur*0.6));
        g.gain.setValueAtTime(0.25*vel, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + rel);
        src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
        src.stop(t0 + rel + 0.05);
      }

      function tom(t0, out, vel, hi=false){
        const osc = ctx.createOscillator(); osc.type="sine";
        const base = hi ? 220 : 150;
        const endf = hi ? 140 : 90;
        osc.frequency.setValueAtTime(base, t0);
        osc.frequency.exponentialRampToValueAtTime(endf, t0 + 0.09);

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.55*vel, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);

        osc.connect(g); g.connect(out);
        osc.start(t0); osc.stop(t0 + 0.22);
      }

      function ride(t0, out, vel, dur){
        // metallic-ish: 2 detuned squares + noise
        const o1 = ctx.createOscillator(); o1.type="square"; o1.frequency.setValueAtTime(380, t0);
        const o2 = ctx.createOscillator(); o2.type="square"; o2.frequency.setValueAtTime(402, t0);

        const mix = ctx.createGain(); mix.gain.setValueAtTime(0.18*vel, t0);

        const src = noiseSource(t0, true);
        const hp = ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=5000;

        const g = ctx.createGain();
        const rel = Math.max(0.18, Math.min(1.0, dur*1.1));
        g.gain.setValueAtTime(0.22*vel, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + rel);

        o1.connect(mix); o2.connect(mix);
        src.connect(hp);
        mix.connect(g); hp.connect(g);
        g.connect(out);

        o1.start(t0); o2.start(t0);
        src.stop(t0 + rel + 0.05);
        o1.stop(t0 + rel + 0.05); o2.stop(t0 + rel + 0.05);
      }

      function crash(t0, out, vel, dur){
        const src = noiseSource(t0, true);
        const hp = ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=3800;
        const bp = ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=7000; bp.Q.value=0.7;

        const g = ctx.createGain();
        const rel = Math.max(0.35, Math.min(1.5, dur*1.6));
        g.gain.setValueAtTime(0.35*vel, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + rel);

        src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
        src.stop(t0 + rel + 0.08);
      }

      function perc(t0, out, vel, f0){
        const osc = ctx.createOscillator(); osc.type="triangle";
        osc.frequency.setValueAtTime(f0, t0);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.35*vel, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
        osc.connect(g); g.connect(out);
        osc.start(t0); osc.stop(t0 + 0.10);
      }

      function pieceFromPc(pc){
        switch(pc){
          case 0:  return { fn:"kick",  lvlKey:"kick"  };
          case 1:  return { fn:"kick2", lvlKey:"kick2" };
          case 2:  return { fn:"snare", lvlKey:"snare" };
          case 3:  return { fn:"clap",  lvlKey:"clap"  };
          case 4:  return { fn:"tomL",  lvlKey:"tomL"  };
          case 5:  return { fn:"tomH",  lvlKey:"tomH"  };
          case 6:  return { fn:"hatC",  lvlKey:"hatC"  };
          case 7:  return { fn:"hatO",  lvlKey:"hatO"  };
          case 8:  return { fn:"ride",  lvlKey:"ride"  };
          case 9:  return { fn:"crash", lvlKey:"crash" };
          case 10: return { fn:"perc",  lvlKey:"perc"  };
          case 11: return { fn:"perc2", lvlKey:"perc2" };
          default: return { fn:"hatC",  lvlKey:"hatC"  };
        }
      }

      function trigger(t, midi, vel=0.9, dur=0.25){
        const pc = ((midi % 12) + 12) % 12;
        const p = pieceFromPc(pc);

        const lvl = (params[p.lvlKey] != null ? params[p.lvlKey] : 1.0);
        const master = (p.gain != null ? p.gain : 1.0);
        const out = mkOut(t, master * Math.max(0, vel) * Math.max(0, lvl));

        if(p.fn === "kick") kick(t, out, vel, false);
        else if(p.fn === "kick2") kick(t, out, vel, true);
        else if(p.fn === "snare") snare(t, out, vel);
        else if(p.fn === "clap") clap(t, out, vel);
        else if(p.fn === "tomL") tom(t, out, vel, false);
        else if(p.fn === "tomH") tom(t, out, vel, true);
        else if(p.fn === "hatC") hatClosed(t, out, vel);
        else if(p.fn === "hatO") hatOpen(t, out, vel, dur);
        else if(p.fn === "ride") ride(t, out, vel, dur);
        else if(p.fn === "crash") crash(t, out, vel, dur);
        else if(p.fn === "perc") perc(t, out, vel, 1200);
        else if(p.fn === "perc2") perc(t, out, vel, 900);
      }

      return { ...common, trigger };
    }
  };

  function makeNoiseBuffer(ctx, seconds){
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<len;i++){
      data[i] = Math.random()*2 - 1;
    }
    return buf;
  }

  window.__INSTRUMENTS__["Drums"] = DEF;
})();