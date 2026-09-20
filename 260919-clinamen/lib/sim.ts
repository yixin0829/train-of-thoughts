import { bowlVoice, type Voice } from "@/lib/audio";
import { contactRadii } from "@/lib/bowl-shape";

/** Pool radius in centimetres (a 3 m pool). The simulation is 2D, on the water's surface. */
export const POOL_R = 150;
/** Three rim inlets, 120 degrees apart: an equilateral triangle, aimed inward. */
export const STREAMS = Array.from({ length: 3 }, (_, i) => {
  const angle = -Math.PI / 2 + (i * Math.PI * 2) / 3;
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  return { x: nx * POOL_R, y: ny * POOL_R, dx: -nx, dy: -ny };
});
export type StreamConfig = {
  speed: number;
  width: number;
  spread: number;
  reach: number;
  /** Zero/omitted keeps a steady jet; otherwise stagger three pulses, seconds. */
  pulsePeriod?: number;
  /** Fraction of a period during which each jet runs, in (0, 1]. */
  pulseDuty?: number;
};
export const DEFAULT_STREAM_CONFIG: Readonly<StreamConfig> = {
  // Five-minute headless spacing study: reports/stream-tuning-pulsed/report.md.
  // Short, staggered pushes avoid the central crowding of steady inward jets.
  speed: 30, width: 33, spread: 0.22, reach: 107,
  pulsePeriod: 70, pulseDuty: 0.47,
};
/** Bowl diameters, cm; repeats weight the draw toward small bowls. */
const SIZES = [12, 12, 14, 14, 16, 16, 18, 18, 20, 22, 24, 27, 30, 34, 36];
/** Relative speed below which a touch is silent, cm/s. */
const SILENT_BELOW = 0.8;
/** Closing speed that counts as the hardest strike, cm/s. */
const HARDEST = 22;
/** A pair that just rang stays quiet this long, so resting contact doesn't chatter. */
const COOLDOWN = 0.15;
const RESTITUTION = 0.45;
/** A thrown bowl is capped at this speed, cm/s. */
const MAX_THROW = 60;
/**
 * The hand pulls a held bowl toward the cursor through a spring, so the bowl's own mass
 * sets how it follows. Over a 30 cm move a 12 cm bowl gets 90 % of the way in 0.25 s; a
 * 36 cm bowl lags to 0.8 s, overshoots a touch, and takes ~1.6 s to haul to a stop.
 */
const HAND_STIFFNESS = 4000;
const HAND_DAMPING = 0.75; // fraction of critical
/** Fastest a held bowl can be dragged, cm/s, so a flick can't tunnel it through a neighbour. */
const MAX_HELD_SPEED = 150;

export type Bowl = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** radius and diameter, cm */
  r: number;
  d: number;
  /** mass, proportional to area */
  m: number;
  voice: Voice;
  /** where the hand is pulling a held bowl, cm; null when the water has it */
  hand: { x: number; y: number } | null;
};

export type Strike = {
  a: Bowl;
  b: Bowl;
  /** intensity in [0, 1], from the closing speed */
  hit: number;
  /** contact point, cm */
  x: number;
  y: number;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Sim {
  bowls: Bowl[] = [];
  /** strength of the current in [0, 1] */
  current = 0.5;
  private time = 0;
  private nextId = 0;
  private lastRang = new Map<string, number>();

  constructor(count: number, readonly streamConfig: Readonly<StreamConfig> = DEFAULT_STREAM_CONFIG) {
    this.place(count);
  }

  /** Scatter `count` bowls without overlap, each already moving with the vortex. */
  place(count: number) {
    this.bowls = [];
    this.lastRang.clear();
    for (let tries = 0; this.bowls.length < count && tries < 4000; tries++) {
      const d = SIZES[Math.floor(Math.random() * SIZES.length)];
      const r = d / 2;
      const a = rand(0, Math.PI * 2);
      const rad = Math.sqrt(Math.random()) * (POOL_R - r - 6);
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (!this.bowls.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 3)) continue;
      const t = a + Math.PI / 2;
      this.bowls.push({
        id: this.nextId++,
        x,
        y,
        vx: Math.cos(t) * 5,
        vy: Math.sin(t) * 5,
        r,
        d,
        m: r * r,
        voice: bowlVoice(d),
        hand: null,
      });
    }
  }

  /** Slow vortex around the pump, plus a wandering component so paths never repeat. */
  private flow(x: number, y: number): [number, number] {
    const t = this.time;
    const d = Math.hypot(x, y) || 1;
    const tx = -y / d;
    const ty = x / d;
    // strong shear: mid-radius water moves fastest, so bowls on different rings pass each other
    const speed = this.current * (2 + 10 * Math.sin((d / POOL_R) * Math.PI));
    const wx = Math.sin(x * 0.03 + t * 0.31) * Math.cos(y * 0.025 - t * 0.19);
    const wy = Math.cos(x * 0.024 - t * 0.23) * Math.sin(y * 0.033 + t * 0.17);
    let fx = tx * speed + wx * this.current * 9;
    let fy = ty * speed + wy * this.current * 9;
    // Water turns along the wall instead of continually pressing bowls into it.
    const outward = Math.max(0, (fx * x + fy * y) / d);
    const edge = Math.max(0, Math.min(1, (d - 100) / 30));
    const turn = edge * edge * (3 - 2 * edge);
    fx -= outward * turn * x / d;
    fy -= outward * turn * y / d;

    for (const [index, stream] of STREAMS.entries()) {
      const px = x - stream.x;
      const py = y - stream.y;
      const along = px * stream.dx + py * stream.dy;
      // Broadening jets blend into the pool near its centre; no opposite-wall push.
      if (along < 0 || along >= this.streamConfig.reach) continue;
      const across = px * -stream.dy + py * stream.dx;
      const width = this.streamConfig.width + along * this.streamConfig.spread;
      const fade = 1 - along / this.streamConfig.reach;
      let pulse = 1;
      if (this.streamConfig.pulsePeriod) {
        const threshold = Math.cos(Math.PI * (this.streamConfig.pulseDuty ?? 0.5));
        const phase = 2 * Math.PI * (t / this.streamConfig.pulsePeriod - index / 3);
        pulse = Math.max(0, (Math.cos(phase) - threshold) / (1 - threshold));
      }
      const strength = this.current * this.streamConfig.speed * Math.exp(-((across / width) ** 2)) * fade * fade * pulse;
      fx += stream.dx * strength;
      fy += stream.dy * strength;
    }
    return [fx, fy];
  }

  /** Advance by `dt` seconds; returns the strikes that happened. */
  step(dt: number): Strike[] {
    this.time += dt;
    for (const b of this.bowls) {
      if (b.hand) {
        // a damped spring to the hand, divided by the bowl's mass
        const damping = 2 * HAND_DAMPING * Math.sqrt(HAND_STIFFNESS * b.m);
        b.vx += ((HAND_STIFFNESS * (b.hand.x - b.x) - damping * b.vx) / b.m) * dt;
        b.vy += ((HAND_STIFFNESS * (b.hand.y - b.y) - damping * b.vy) / b.m) * dt;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > MAX_HELD_SPEED) {
          b.vx *= MAX_HELD_SPEED / sp;
          b.vy *= MAX_HELD_SPEED / sp;
        }
      } else {
        const [fx, fy] = this.flow(b.x, b.y);
        const k = (0.9 * dt) / Math.sqrt(b.m / 36); // big bowls answer the current more slowly
        b.vx += (fx - b.vx) * k;
        b.vy += (fy - b.vy) * k;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const d = Math.hypot(b.x, b.y);
      const lim = POOL_R - b.r;
      if (d > lim) {
        const nx = b.x / d;
        const ny = b.y / d;
        b.x = nx * lim;
        b.y = ny * lim;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) {
          b.vx -= 1.3 * vn * nx;
          b.vy -= 1.3 * vn * ny;
        }
      }
    }

    const strikes: Strike[] = [];
    for (let i = 0; i < this.bowls.length; i++) {
      const a = this.bowls[i];
      for (let j = i + 1; j < this.bowls.length; j++) {
        const b = this.bowls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const [ra, rb] = contactRadii(a.d, b.d);
        const minD = ra + rb;
        if (dist >= minD) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        // separate by inverse mass; a held bowl is pushed back too, and the hand feels it
        const ia = 1 / a.m;
        const ib = 1 / b.m;
        const isum = ia + ib;
        const overlap = minD - dist;
        a.x -= nx * overlap * (ia / isum);
        a.y -= ny * overlap * (ia / isum);
        b.x += nx * overlap * (ib / isum);
        b.y += ny * overlap * (ib / isum);
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny; // negative when closing
        if (vn >= 0) continue;
        const jimp = (-(1 + RESTITUTION) * vn) / isum;
        a.vx -= jimp * nx * ia;
        a.vy -= jimp * ny * ia;
        b.vx += jimp * nx * ib;
        b.vy += jimp * ny * ib;
        const key = `${a.id}:${b.id}`;
        if (-vn > SILENT_BELOW && this.time - (this.lastRang.get(key) ?? -Infinity) > COOLDOWN) {
          this.lastRang.set(key, this.time);
          strikes.push({ a, b, hit: Math.min(1, -vn / HARDEST), x: a.x + nx * ra, y: a.y + ny * ra });
        }
      }
    }
    return strikes;
  }

  /** The bowl under a point on the water (cm), if any; the topmost when they overlap. */
  bowlAt(x: number, y: number) {
    return this.bowls.findLast((b) => Math.hypot(b.x - x, b.y - y) <= b.r * 1.2) ?? null;
  }

  /**
   * Take hold of a bowl, or move the hand that holds it, to a point on the water (cm).
   * The hand stays inside the pool: a bowl can be pushed against the wall but not through it.
   */
  pull(b: Bowl, x: number, y: number) {
    const lim = POOL_R - b.r;
    const d = Math.hypot(x, y);
    const k = d > lim ? lim / d : 1;
    b.hand = { x: x * k, y: y * k };
  }

  /** Let go of a held bowl; it keeps its momentum, within reason. */
  release(b: Bowl) {
    b.hand = null;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_THROW) {
      b.vx *= MAX_THROW / sp;
      b.vy *= MAX_THROW / sp;
    }
  }
}
