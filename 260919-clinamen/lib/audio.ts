/**
 * Struck porcelain in a large hall, fitted to a recording of the installation
 * (see "Sound model" in the README for the measurements behind each number).
 */

/** What a bowl sounds like; fixed when the bowl is made. */
export type Voice = {
  /** fundamental, Hz */
  freq: number;
  /** doublet detune as a fraction of freq: a bowl is never perfectly round, so its lowest mode beats */
  split: number;
  /** seconds for the fundamental to fall 60 dB */
  t60: number;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Size sets pitch and ring. Measured fundamentals ran from about 170 Hz to 1 kHz, with
 * most between 300 and 700 Hz, and fell a median 3.5 dB/s (a T60 near 10 s), so a 12 cm
 * bowl maps to ~1 kHz ringing 6 s and a 36 cm bowl to ~215 Hz ringing 11 s.
 */
export function bowlVoice(diameterCm: number): Voice {
  return {
    freq: 1000 * Math.pow(12 / diameterCm, 1.4) * rand(0.97, 1.03),
    split: rand(0.001, 0.003),
    t60: 6 + 5 * ((diameterCm - 12) / 24),
  };
}

/**
 * [frequency ratio, amplitude, fraction of the fundamental's t60]. The ratios are the bowl's
 * (2,0) (3,0) (4,0) (5,0) shell modes as measured (2.75 and 5.17; the fourth is extrapolated).
 * The second mode strikes as loud as the fundamental but dies five times faster, the higher
 * ones faster still, so the long ring is almost pure fundamental: that is the hollow sound.
 */
const PARTIALS: [number, number, number][] = [
  [1, 1, 1],
  [2.75, 1, 0.2],
  [5.17, 0.5, 0.08],
  [8.4, 0.2, 0.04],
];

/** Voices beyond this are faded out, oldest first. */
const MAX_VOICES = 48;

type Playing = { key: object; out: GainNode; end: number };

export class Chimes {
  readonly ctx: AudioContext;
  private master: GainNode;
  private dry: GainNode;
  private hall: ConvolverNode;
  private playing: Playing[] = [];

  constructor() {
    this.ctx = new AudioContext();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.3;
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.5;
    this.hall = ctx.createConvolver();
    this.hall.buffer = hallImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.75;
    this.dry.connect(comp);
    this.hall.connect(wet).connect(comp);
    comp.connect(this.master).connect(ctx.destination);
  }

  resume() {
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setLevel(level: number) {
    this.master.gain.setTargetAtTime(level, this.ctx.currentTime, 0.03);
  }

  /**
   * Ring one bowl. `key` identifies the bowl so a restrike replaces its previous voice;
   * `hit` in [0, 1] sets loudness and brightness; `pan` in [−1, 1] places it left to right.
   */
  strike(key: object, voice: Voice, hit: number, pan: number) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.playing = this.playing.filter((p) => p.end > t);
    for (const p of this.playing) if (p.key === key) fade(p, t);
    this.playing = this.playing.filter((p) => p.key !== key);
    while (this.playing.length >= MAX_VOICES) fade(this.playing.shift()!, t);

    const out = ctx.createGain();
    out.gain.value = 0.35 * Math.min(1, hit);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(panner);
    panner.connect(this.dry);
    panner.connect(this.hall);
    const end = playVoice(ctx, out, voice, hit, t);
    this.playing.push({ key, out, end });
  }

  close() {
    void this.ctx.close();
  }
}

function fade(p: Playing, t: number) {
  p.out.gain.cancelScheduledValues(t);
  p.out.gain.setTargetAtTime(0, t, 0.03);
}

/** Schedule one strike into `out` at time `t`; returns when it has fallen silent. Works offline too. */
export function playVoice(ctx: BaseAudioContext, out: AudioNode, voice: Voice, hit: number, t: number) {
  let end = t;
  PARTIALS.forEach(([ratio, amp, frac], i) => {
    const f = voice.freq * ratio;
    if (f > 12000) return;
    // harder hits reach the upper modes
    const a = i === 0 ? amp : amp * (0.3 + 0.7 * Math.min(1, hit));
    const T = voice.t60 * frac * rand(0.9, 1.1);
    const dets = i === 0 ? [-1, 1] : [0];
    for (const s of dets) {
      const o = ctx.createOscillator();
      o.frequency.value = f * (1 + s * voice.split);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a / dets.length, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + T);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + T + 0.05);
    }
    end = Math.max(end, t + T + 0.05);
  });

  // the "tok" of porcelain on porcelain: 25 ms of band-passed noise
  const len = Math.floor(ctx.sampleRate * 0.025);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const n = ctx.createBufferSource();
  n.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = Math.min(5000, voice.freq * 5);
  bp.Q.value = 1.5;
  const ng = ctx.createGain();
  ng.gain.value = 0.8 * Math.min(1, hit);
  n.connect(bp).connect(ng).connect(out);
  n.start(t);
  return end;
}

/**
 * A synthetic impulse response for a very large, hard room (the Armory's drill hall): a short
 * pre-delay, a spray of early reflections, then a noise tail whose lows outlast its highs.
 */
export function hallImpulse(ctx: BaseAudioContext, seconds = 6) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(0.03 * sr);
  // T60 per band, seconds
  const T = { low: 5, mid: 3.8, high: 1.6 };
  const kLow = 1 - Math.exp((-2 * Math.PI * 400) / sr);
  const kHigh = 1 - Math.exp((-2 * Math.PI * 2500) / sr);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    let lp = 0;
    let lp2 = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const w = Math.random() * 2 - 1;
      lp += kLow * (w - lp);
      lp2 += kHigh * (w - lp2);
      const low = lp;
      const mid = lp2 - lp;
      const high = w - lp2;
      const onset = Math.min(1, t / 0.08); // the tail swells in as reflections pile up
      ch[i] =
        onset *
        (2.2 * low * Math.exp((-6.91 * t) / T.low) +
          mid * Math.exp((-6.91 * t) / T.mid) +
          0.6 * high * Math.exp((-6.91 * t) / T.high));
    }
    // early reflections from the floor, walls and the vault
    for (let k = 0; k < 14; k++) {
      const i = pre + Math.floor(rand(0.005, 0.12) * sr);
      ch[i] += (Math.random() < 0.5 ? -1 : 1) * rand(0.3, 0.8) * Math.exp(-(i - pre) / sr / 0.1);
    }
  }
  return buf;
}
