// Measures the bowl sounds in the installation video, for fitting lib/audio.ts.
//
// YouTube won't let the audio leave the page (its CSP blocks fetch, frames and popups),
// so the analysis runs where the audio is. Open https://www.youtube.com/watch?v=_TaMMeav8I0,
// paste this file into the devtools console, and wait ~40 s while the clip plays once.
// It logs the numbers quoted in the README's "Sound model" section.

(async () => {
  // ---------- record the clip once, mono, at the context rate ----------
  const v = document.querySelector("video");
  v.pause();
  v.currentTime = 0;
  v.loop = false;
  const ctx = new AudioContext();
  await ctx.resume();
  const sr = ctx.sampleRate;
  const src = ctx.createMediaStreamSource(v.captureStream());
  const proc = ctx.createScriptProcessor(4096, 2, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  const chunks = [];
  let done = false;
  proc.onaudioprocess = (e) => {
    if (done || v.paused) return;
    const l = e.inputBuffer.getChannelData(0), r = e.inputBuffer.getChannelData(1);
    chunks.push(Float32Array.from(l, (s, i) => 0.5 * (s + r[i])));
  };
  src.connect(proc).connect(sink).connect(ctx.destination);
  v.addEventListener("ended", () => (done = true), { once: true });
  await v.play();
  while (!done && v.currentTime < v.duration - 0.05) await new Promise((r) => setTimeout(r, 500));
  done = true;
  v.pause();
  const x = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
  chunks.reduce((o, c) => (x.set(c, o), o + c.length), 0);

  // ---------- spectra ----------
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const p = i + k, q = p + len / 2;
          const xr = re[q] * cr - im[q] * ci, xi = re[q] * ci + im[q] * cr;
          re[q] = re[p] - xr; im[q] = im[p] - xi; re[p] += xr; im[p] += xi;
          [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
        }
      }
    }
  }
  const spec = (s0, n) => {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = (x[s0 + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    fft(re, im);
    return Float64Array.from({ length: n / 2 }, (_, i) => Math.hypot(re[i], im[i]));
  };

  // ---------- 1. stationary partials: peaks that hold within 0.4 % for ≥ 0.6 s ----------
  // Speech glides, so it rarely survives; a struck bowl does.
  const N = 16384, H = 4096, hz0 = sr / N, dt = H / sr, bw = Math.round(80 / hz0);
  const frames = [];
  for (let s = 0; s + N <= x.length; s += H) frames.push(spec(s, N));
  const peaks = frames.map((m) => {
    const db = Array.from(m, (a) => 20 * Math.log10(a + 1e-12));
    const out = [];
    for (let i = 3; i < db.length - 3; i++) {
      const hz = i * hz0;
      if (hz < 120 || hz > 10000 || !(db[i] > db[i - 1] && db[i] >= db[i + 1] && db[i] > db[i - 2] && db[i] >= db[i + 2])) continue;
      const floor = db.slice(i - bw, i + bw).sort((a, b) => a - b)[bw];
      if (db[i] - floor > 12) out.push({ hz: i * hz0 + (0.5 * (db[i - 1] - db[i + 1])) / (db[i - 1] - 2 * db[i] + db[i + 1]) * hz0, d: db[i] });
    }
    return out;
  });
  let open = [];
  const tracks = [];
  peaks.forEach((ps, f) => {
    const next = [];
    for (const p of ps) {
      const t = open.find((t) => !t.used && Math.abs(t.hz - p.hz) / p.hz < 0.004);
      if (t) { t.used = true; t.pts.push([f * dt, p.d]); t.hz = p.hz; next.push(t); }
      else next.push({ hz: p.hz, pts: [[f * dt, p.d]] });
    }
    tracks.push(...open.filter((t) => !t.used));
    open = next.map((t) => ((t.used = false), t));
  });
  tracks.push(...open);
  const long = tracks.filter((t) => t.pts.length >= 7).map((t) => {
    const n = t.pts.length, mt = t.pts.reduce((a, p) => a + p[0], 0) / n, md = t.pts.reduce((a, p) => a + p[1], 0) / n;
    const slope = t.pts.reduce((a, p) => a + (p[0] - mt) * (p[1] - md), 0) / t.pts.reduce((a, p) => a + (p[0] - mt) ** 2, 0);
    return { t0: +t.pts[0][0].toFixed(2), hz: Math.round(t.hz), dur: +(n * dt).toFixed(2), peakDb: Math.round(Math.max(...t.pts.map((p) => p[1]))), slopeDbPerS: +slope.toFixed(1) };
  });
  console.table(long);

  // ---------- 2. partial ratios: pairs of tracks sounding together ----------
  const ratios = [];
  for (const a of long) for (const b of long)
    if (b.hz > a.hz && Math.abs(b.t0 - a.t0) < 0.5) { const r = b.hz / a.hz; if (r > 2.6 && r < 2.9) ratios.push(+r.toFixed(3)); }
  const median = (a) => a.slice().sort((p, q) => p - q)[Math.floor((a.length - 1) / 2)];
  console.log("second-mode ratio, median of", ratios.length, "pairs:", median(ratios));

  // ---------- 3. decay: dB/s of low (< 700 Hz) and high (> 1.1 kHz) partials ----------
  const lo = long.filter((t) => t.hz < 700).map((t) => t.slopeDbPerS);
  const hi = long.filter((t) => t.hz >= 1100).map((t) => t.slopeDbPerS);
  console.log("median decay, dB/s: low partials", median(lo), "· high partials", median(hi));

  // ---------- 4. long-term spectrum in half-octave bands, dB below the loudest ----------
  const edges = [88, 125, 177, 250, 354, 500, 707, 1000, 1414, 2000, 2828, 4000, 5657, 8000, 11314];
  const ltas = (t0, t1) => {
    const n = 8192, e = new Float64Array(n / 2);
    for (let s = Math.floor(t0 * sr); s + n <= Math.min(x.length, t1 * sr); s += n / 2) spec(s, n).forEach((m, i) => (e[i] += m * m));
    const bands = edges.slice(0, -1).map((a, k) => {
      let s = 0;
      for (let i = Math.ceil(a / (sr / n)); i < edges[k + 1] / (sr / n); i++) s += e[i];
      return 10 * Math.log10(s + 1e-12);
    });
    const mx = Math.max(...bands);
    return bands.map((b) => Math.round(b - mx));
  };
  console.log("band centres, Hz:", edges.slice(0, -1).map((a) => Math.round(a * Math.SQRT2 ** 0.5)).join(" "));
  console.log("whole clip:       ", ltas(0, x.length / sr).join(" "));
  console.log("last 3 s (least speech):", ltas(x.length / sr - 3.2, x.length / sr).join(" "));
})();
