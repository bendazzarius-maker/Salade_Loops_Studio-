const FFT = require('fft.js');

class PitchShifter {
  constructor(options = {}) {
    this.fftSize = options.fftSize || 2048;
    this.overlap = options.overlap || 0.75;
    this.hopSize = options.hopSize || Math.floor(this.fftSize * (1 - this.overlap));
    this.sampleRate = options.sampleRate || 48000;

    this.binCount = (this.fftSize >> 1) + 1;
    this.fft = new FFT(this.fftSize);

    this.window = this._createHannWindow(this.fftSize);
    this.analysisPrevPhase = new Float32Array(this.binCount);
    this.synthesisPhase = new Float32Array(this.binCount);

    this.inputComplex = this.fft.createComplexArray();
    this.spectrum = this.fft.createComplexArray();
    this.ifftComplex = this.fft.createComplexArray();

    this.magnitudes = new Float32Array(this.binCount);
    this.trueFreq = new Float32Array(this.binCount);

    this.synthMagnitudes = new Float32Array(this.binCount);
    this.synthFreqNum = new Float32Array(this.binCount);
    this.synthFreqDen = new Float32Array(this.binCount);

    this.frame = new Float32Array(this.fftSize);
  }

  process(inputBuffer, pitchFactor) {
    const factor = Math.max(0.01, pitchFactor || 1.0);
    const inputLength = inputBuffer.length;
    const outputBuffer = new Float32Array(inputLength);

    const olaLength = inputLength + this.fftSize;
    const ola = new Float32Array(olaLength);
    const norm = new Float32Array(olaLength);

    this.analysisPrevPhase.fill(0);
    this.synthesisPhase.fill(0);

    for (let frameStart = 0; frameStart < inputLength; frameStart += this.hopSize) {
      this._analysis(inputBuffer, frameStart);
      this._pitchMap(factor);
      this._synthesis(frameStart, ola, norm);
    }

    for (let i = 0; i < inputLength; i += 1) {
      const n = norm[i];
      outputBuffer[i] = n > 1e-9 ? ola[i] / n : 0;
    }

    return outputBuffer;
  }

  _analysis(inputBuffer, frameStart) {
    const twoPi = 2 * Math.PI;

    for (let n = 0; n < this.fftSize; n += 1) {
      const sampleIndex = frameStart + n;
      const sample = sampleIndex < inputBuffer.length ? inputBuffer[sampleIndex] : 0;
      this.frame[n] = sample * this.window[n];

      const idx = n << 1;
      this.inputComplex[idx] = this.frame[n];
      this.inputComplex[idx + 1] = 0;
    }

    this.fft.transform(this.spectrum, this.inputComplex);

    for (let k = 0; k < this.binCount; k += 1) {
      const i = k << 1;
      const re = this.spectrum[i];
      const im = this.spectrum[i + 1];

      const mag = Math.hypot(re, im);
      const phase = Math.atan2(im, re);
      const expectedAdvance = (twoPi * this.hopSize * k) / this.fftSize;

      let delta = phase - this.analysisPrevPhase[k] - expectedAdvance;
      delta = this._wrapToPi(delta);

      const instRadPerSample = (twoPi * k) / this.fftSize + delta / this.hopSize;

      this.magnitudes[k] = mag;
      this.trueFreq[k] = instRadPerSample;
      this.analysisPrevPhase[k] = phase;
    }
  }

  _pitchMap(pitchFactor) {
    this.synthMagnitudes.fill(0);
    this.synthFreqNum.fill(0);
    this.synthFreqDen.fill(0);

    for (let k = 0; k < this.binCount; k += 1) {
      const mag = this.magnitudes[k];
      if (mag < 1e-12) continue;

      const shiftedBin = k * pitchFactor;
      const j0 = Math.floor(shiftedBin);
      if (j0 >= this.binCount) continue;

      const frac = shiftedBin - j0;
      const j1 = j0 + 1;

      const shiftedFreq = this.trueFreq[k] * pitchFactor;

      const w0 = 1 - frac;
      this.synthMagnitudes[j0] += mag * w0;
      this.synthFreqNum[j0] += shiftedFreq * mag * w0;
      this.synthFreqDen[j0] += mag * w0;

      if (j1 < this.binCount) {
        const w1 = frac;
        this.synthMagnitudes[j1] += mag * w1;
        this.synthFreqNum[j1] += shiftedFreq * mag * w1;
        this.synthFreqDen[j1] += mag * w1;
      }
    }
  }

  _synthesis(frameStart, ola, norm) {
    const twoPi = 2 * Math.PI;

    for (let k = 0; k < this.binCount; k += 1) {
      const mag = this.synthMagnitudes[k];
      const centerFreq = (twoPi * k) / this.fftSize;
      const freq = this.synthFreqDen[k] > 0 ? this.synthFreqNum[k] / this.synthFreqDen[k] : centerFreq;

      this.synthesisPhase[k] = this._wrapToPi(this.synthesisPhase[k] + freq * this.hopSize);

      const i = k << 1;
      const phase = this.synthesisPhase[k];
      this.spectrum[i] = mag * Math.cos(phase);
      this.spectrum[i + 1] = mag * Math.sin(phase);
    }

    for (let k = this.binCount; k < this.fftSize; k += 1) {
      const mirror = this.fftSize - k;
      const i = k << 1;
      const mi = mirror << 1;
      this.spectrum[i] = this.spectrum[mi];
      this.spectrum[i + 1] = -this.spectrum[mi + 1];
    }

    this.fft.inverseTransform(this.ifftComplex, this.spectrum);

    for (let n = 0; n < this.fftSize; n += 1) {
      const sample = (this.ifftComplex[n << 1] / this.fftSize) * this.window[n];
      const outIndex = frameStart + n;
      if (outIndex < ola.length) {
        ola[outIndex] += sample;
        norm[outIndex] += this.window[n] * this.window[n];
      }
    }
  }

  _createHannWindow(size) {
    const w = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
      w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return w;
  }

  _wrapToPi(value) {
    const twoPi = 2 * Math.PI;
    let wrapped = value;
    while (wrapped > Math.PI) wrapped -= twoPi;
    while (wrapped < -Math.PI) wrapped += twoPi;
    return wrapped;
  }
}

module.exports = PitchShifter;
