/* ============ UltraTune — Web Audio deck engine ============ */
/*
 * Two Deck instances share one AudioContext through AudioEngine.
 * Per-deck graph:
 *   source → eqLow → eqMid → eqHigh → filter → boost → deckGain → xfGain → master
 * with an echo send tapped off deckGain (delay + feedback → echoWet → xfGain).
 * Tempo uses playbackRate, so pitch bends with speed — like real vinyl.
 */

"use strict";

const AudioEngine = (() => {
  let ctx = null;
  let master, analyser, recDest;
  let recorder = null;
  let recChunks = [];

  function init() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.9;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    master.connect(analyser);
    analyser.connect(ctx.destination);
    recDest = ctx.createMediaStreamDestination();
    master.connect(recDest);
    return ctx;
  }

  function resume() {
    init();
    if (ctx.state === "suspended") ctx.resume();
  }

  function setMasterVolume(v) {
    init();
    master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
  }

  function startRecording() {
    init();
    if (recorder) return false;
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "";
    recChunks = [];
    recorder = new MediaRecorder(recDest.stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    recorder.start(1000);
    return true;
  }

  function stopRecording() {
    return new Promise((resolve) => {
      if (!recorder) return resolve(null);
      const r = recorder;
      recorder = null;
      r.onstop = () => resolve(new Blob(recChunks, { type: r.mimeType || "audio/webm" }));
      r.stop();
    });
  }

  return {
    init, resume, setMasterVolume, startRecording, stopRecording,
    get ctx() { return ctx; },
    get master() { init(); return master; },
    get analyser() { init(); return analyser; },
    get recording() { return !!recorder; },
  };
})();

class Deck {
  constructor(id) {
    this.id = id;
    this.buffer = null;
    this.source = null;
    this.playing = false;
    this.offset = 0;        // seconds into the track when (re)started
    this.startedAt = 0;     // ctx.currentTime at (re)start
    this.rate = 1;
    this.cuePoint = 0;
    this.loopStart = null;
    this.loopEnd = null;
    this.looping = false;
    this.braking = false;
    this.peaks = null;      // waveform peaks, computed on load
    this.meta = { title: "No track loaded", artist: "", src: "" };
    this.onstatechange = null; // UI callback

    const ctx = AudioEngine.init();
    this.eqLow = ctx.createBiquadFilter();
    this.eqLow.type = "lowshelf";
    this.eqLow.frequency.value = 200;
    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = "peaking";
    this.eqMid.frequency.value = 1200;
    this.eqMid.Q.value = 0.8;
    this.eqHigh = ctx.createBiquadFilter();
    this.eqHigh.type = "highshelf";
    this.eqHigh.frequency.value = 3600;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 1.1;
    this.boostNode = ctx.createBiquadFilter();
    this.boostNode.type = "lowshelf";
    this.boostNode.frequency.value = 110;
    this.boostNode.gain.value = 0;
    this.deckGain = ctx.createGain();
    this.deckGain.gain.value = 0.9;
    this.xfGain = ctx.createGain();
    this.xfGain.gain.value = 1;

    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.filter);
    this.filter.connect(this.boostNode);
    this.boostNode.connect(this.deckGain);
    this.deckGain.connect(this.xfGain);
    this.xfGain.connect(AudioEngine.master);

    // echo send: deckGain → delay ↔ feedback → echoWet → xfGain
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.3;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.42;
    this.echoWet = ctx.createGain();
    this.echoWet.gain.value = 0;
    this.deckGain.connect(this.delay);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.echoWet);
    this.echoWet.connect(this.xfGain);

    this.boostOn = false;
    this.echoOn = false;
  }

  get ctx() { return AudioEngine.ctx; }
  get duration() { return this.buffer ? this.buffer.duration : 0; }

  async load(arrayBuffer, meta) {
    AudioEngine.resume();
    const buf = await this.ctx.decodeAudioData(arrayBuffer);
    this.stopSource();
    this.buffer = buf;
    this.offset = 0;
    this.cuePoint = 0;
    this.loopStart = this.loopEnd = null;
    this.looping = false;
    this.playing = false;
    this.meta = meta || this.meta;
    this.computePeaks(600);
    this.emit();
  }

  computePeaks(columns) {
    const data = this.buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / columns));
    const peaks = new Float32Array(columns);
    for (let c = 0; c < columns; c++) {
      let max = 0;
      const start = c * step;
      const end = Math.min(start + step, data.length);
      // sample sparsely inside the window — plenty for a 600px waveform
      for (let i = start; i < end; i += 16) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      peaks[c] = max;
    }
    this.peaks = peaks;
  }

  position() {
    if (!this.buffer) return 0;
    let pos = this.playing
      ? this.offset + (this.ctx.currentTime - this.startedAt) * this.rate
      : this.offset;
    if (this.looping && this.loopEnd != null && pos > this.loopEnd) {
      const len = this.loopEnd - this.loopStart;
      pos = this.loopStart + ((pos - this.loopStart) % len);
    }
    return Math.min(Math.max(pos, 0), this.duration);
  }

  stopSource() {
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop(); } catch { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  startSource(fromSec) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    if (this.looping && this.loopStart != null && this.loopEnd != null) {
      src.loop = true;
      src.loopStart = this.loopStart;
      src.loopEnd = this.loopEnd;
    }
    src.connect(this.eqLow);
    src.onended = () => {
      if (this.source === src) {
        this.playing = false;
        this.offset = 0;
        this.source = null;
        this.emit();
      }
    };
    src.start(0, fromSec);
    this.source = src;
    this.offset = fromSec;
    this.startedAt = this.ctx.currentTime;
  }

  play() {
    if (!this.buffer || this.playing || this.braking) return;
    AudioEngine.resume();
    this.startSource(this.offset >= this.duration ? 0 : this.offset);
    this.playing = true;
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.position();
    this.stopSource();
    this.playing = false;
    this.emit();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  seek(sec) {
    if (!this.buffer) return;
    sec = Math.min(Math.max(sec, 0), this.duration);
    if (this.playing) {
      this.stopSource();
      this.startSource(sec);
    } else {
      this.offset = sec;
    }
    this.emit();
  }

  setRate(rate) {
    this.rate = rate;
    if (this.playing && this.source && !this.braking) {
      // re-anchor position bookkeeping so tracking stays exact across changes
      this.offset = this.position();
      this.startedAt = this.ctx.currentTime;
      this.source.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.03);
    }
  }

  brake() {
    if (!this.playing || !this.source || this.braking) return;
    this.braking = true;
    const now = this.ctx.currentTime;
    const src = this.source;
    src.playbackRate.cancelScheduledValues(now);
    src.playbackRate.setValueAtTime(this.rate, now);
    src.playbackRate.linearRampToValueAtTime(0.001, now + 1.1);
    // position advances ~rate*1.1/2 during a linear spin-down
    const advance = this.rate * 1.1 / 2;
    setTimeout(() => {
      if (this.source === src) {
        this.offset = Math.min(this.offset + (now - this.startedAt) * this.rate + advance, this.duration);
        this.stopSource();
        this.playing = false;
      }
      this.braking = false;
      this.emit();
    }, 1150);
    this.emit();
  }

  cue() {
    if (!this.buffer) return;
    if (this.playing) {
      this.cuePoint = this.position();
    } else if (Math.abs(this.offset - this.cuePoint) < 0.05) {
      this.play();
      return;
    } else {
      this.seek(this.cuePoint);
    }
    this.emit();
  }

  setLoopIn() {
    if (!this.buffer) return;
    this.loopStart = this.position();
    this.loopEnd = null;
    this.looping = false;
    this.applyLoop();
    this.emit();
  }

  setLoopOut() {
    if (!this.buffer || this.loopStart == null) return;
    const pos = this.position();
    if (pos <= this.loopStart + 0.05) return;
    this.loopEnd = pos;
    this.looping = true;
    this.applyLoop();
    this.emit();
  }

  exitLoop() {
    this.looping = false;
    this.loopStart = this.loopEnd = null;
    this.applyLoop();
    this.emit();
  }

  applyLoop() {
    if (!this.source) return;
    if (this.looping && this.loopStart != null && this.loopEnd != null) {
      // restart the source so loop bounds take effect cleanly
      const pos = Math.min(this.position(), this.loopEnd - 0.01);
      this.stopSource();
      this.startSource(pos);
    } else if (this.source.loop) {
      const pos = this.position();
      this.stopSource();
      this.startSource(pos);
    }
  }

  setEQ(band, dB) {
    const node = band === "lo" ? this.eqLow : band === "mid" ? this.eqMid : this.eqHigh;
    node.gain.setTargetAtTime(dB, this.ctx.currentTime, 0.02);
  }

  /* v in [-1, 1]: negative sweeps a lowpass down, positive sweeps a highpass up */
  setFilter(v) {
    const now = this.ctx.currentTime;
    if (v < -0.03) {
      this.filter.type = "lowpass";
      this.filter.frequency.setTargetAtTime(20000 * Math.pow(10, v * 2.6), now, 0.02);
    } else if (v > 0.03) {
      this.filter.type = "highpass";
      this.filter.frequency.setTargetAtTime(20 * Math.pow(10, v * 2.85), now, 0.02);
    } else {
      this.filter.type = "lowpass";
      this.filter.frequency.setTargetAtTime(20000, now, 0.02);
    }
  }

  setVolume(v) {
    this.deckGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  toggleBoost() {
    this.boostOn = !this.boostOn;
    this.boostNode.gain.setTargetAtTime(this.boostOn ? 9 : 0, this.ctx.currentTime, 0.05);
    this.emit();
    return this.boostOn;
  }

  toggleEcho() {
    this.echoOn = !this.echoOn;
    this.echoWet.gain.setTargetAtTime(this.echoOn ? 0.55 : 0, this.ctx.currentTime, 0.1);
    this.emit();
    return this.echoOn;
  }

  setCrossfadeGain(g) {
    this.xfGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
  }

  emit() { if (this.onstatechange) this.onstatechange(this); }
}
