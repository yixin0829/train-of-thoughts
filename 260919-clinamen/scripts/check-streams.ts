// Run with: bun scripts/check-streams.ts
import assert from "node:assert/strict";
import { Sim, STREAMS, POOL_R, type Bowl } from "../lib/sim";
import { bowlVoice } from "../lib/audio";

const sides = STREAMS.map((s, i) => Math.hypot(s.x - STREAMS[(i + 1) % 3].x, s.y - STREAMS[(i + 1) % 3].y));
assert.ok(Math.max(...sides) - Math.min(...sides) < 1e-9);
for (const s of STREAMS) {
  assert.ok(Math.abs(Math.hypot(s.x, s.y) - POOL_R) < 1e-9);
  assert.ok(Math.hypot(s.x + s.dx * POOL_R, s.y + s.dy * POOL_R) < 1e-9);
}

let slowest = 0;
for (const diameter of [12, 24, 36]) for (let angle = 0; angle < 360; angle += 10) {
  const sim = new Sim(0);
  const r = diameter / 2;
  const rad = angle * Math.PI / 180;
  const b: Bowl = {id: 0, d: diameter, r, m: r * r, x: (POOL_R - r) * Math.cos(rad), y: (POOL_R - r) * Math.sin(rad), vx: 0, vy: 0, hand: null, voice: bowlVoice(diameter)};
  sim.bowls = [b];
  let escaped = false;
  for (let step = 0; step < 120 * 90; step++) {
    sim.step(1 / 120);
    assert.ok(Number.isFinite(b.x + b.y + b.vx + b.vy));
    if (Math.hypot(b.x, b.y) < POOL_R - r - 12) {
      slowest = Math.max(slowest, step / 120);
      escaped = true;
      break;
    }
  }
  assert.ok(escaped, `${diameter} cm bowl stuck at ${angle} degrees`);
}
const off = new Sim(1);
off.current = 0;
off.bowls[0].vx = off.bowls[0].vy = 0;
const start = [off.bowls[0].x, off.bowls[0].y];
for (let i = 0; i < 120; i++) off.step(1 / 120);
assert.deepEqual([off.bowls[0].x, off.bowls[0].y], start);
console.log(`PASS: equilateral inlets; 108 rim placements move 12 cm inward within ${slowest.toFixed(1)} s; current=0 disables streams.`);
