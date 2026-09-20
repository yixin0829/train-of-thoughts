// Browser regression harness. Bundle with:
// bun build ./scripts/check-water.js --outfile ./public/check-water.js --target browser
// Then call (await import('/check-water.js')).checkWater() in the local page.
// Remove public/check-water.js after running; it is a generated diagnostic bundle.
import * as THREE from 'three';
import { Waves, GRID } from '../lib/scene/waves';
import { Sim } from '../lib/sim';
import { contactRadii } from '../lib/bowl-shape';
import { buildPool } from '../lib/scene/water';

// Render the real surface over a uniform colour: no pool floor, caustics or
// underwater texture detail can contribute to the measured ripple visibility.
export function checkSurface() {
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(512, 512);
  const pool = buildPool(new THREE.Vector3(1.5, 3.4, 1.1));
  const surface = pool.group.children.find(o => o.material?.uniforms?.uUnder);
  const under = new THREE.DataTexture(new Uint8Array([50, 130, 165, 255]), 1, 1);
  under.needsUpdate = true;
  surface.material.uniforms.uUnder.value = under;
  const scene = new THREE.Scene();
  scene.add(surface);
  const target = new THREE.WebGLRenderTarget(512, 512);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 30);
  const render = () => {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(512 * 512 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 512, 512, pixels);
    return pixels;
  };
  const results = [];
  for (const position of [[0, 1.53, 3.73], [0, 3.4, 1.6], [3.73, 1.53, 0]]) {
    camera.position.set(...position);
    camera.lookAt(0, 0, 0);
    const waves = new Waves(renderer, 1.5);
    pool.height.value = waves.texture;
    const before = render();
    waves.drop(0.2, 0.4, 0.08, 0.6);
    for (let i = 0; i < 8; i++) waves.update(1 / 60, []);
    pool.height.value = waves.texture;
    const after = render();
    const centre = new THREE.Vector3(0.2, 0, 0.4).project(camera);
    let visible = 0, remote = 0, peak = 0;
    for (let i = 0; i < after.length; i += 4) {
      const delta = Math.max(...[0, 1, 2].map(c => Math.abs(after[i + c] - before[i + c])));
      peak = Math.max(peak, delta);
      if (delta < 3) continue;
      visible++;
      const x = (i / 4) % 512, y = Math.floor(i / 4 / 512);
      if (Math.hypot(x - (centre.x + 1) * 256, y - (centre.y + 1) * 256) > 65) remote++;
    }
    // A soft reflection spreads contrast over an area instead of making a sharp
    // skylight glint. Require visible pixels (delta >= 3 above) at the impact,
    // without imposing the old fixture's peak brightness on the chosen treatment.
    results.push({position, pass: visible > 20 && remote === 0, visible, remote, peak});
    waves.dispose();
  }
  target.dispose();
  under.dispose();
  pool.dispose();
  renderer.dispose();
  return {pass: results.every(r => r.pass), results};
}

export function checkWater() {
  const renderer = new THREE.WebGLRenderer();
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass, detail });
  const read = (waves) => {
    const pixels = new Uint16Array(GRID * GRID * 4);
    renderer.readRenderTargetPixels(waves.targets[0], 0, 0, GRID, GRID, pixels);
    return Array.from({ length: GRID * GRID }, (_, i) => THREE.DataUtils.fromHalfFloat(pixels[4 * i]));
  };
  const sample = (heights, x, z) => heights[Math.floor((z / 3 + 0.5) * GRID) * GRID + Math.floor((x / 3 + 0.5) * GRID)];
  const waves = new Waves(renderer, 1.5);
  const sim = new Sim(0);
  sim.current = 0;
  const bowl = (id, x, vx) => ({id, x, y: 42, vx, vy: 0, r: 10, d: 20, m: 100, hand: null});
  sim.bowls = [bowl(0, 29.9, 10), bowl(1, 50, -10)];
  const [strike] = sim.step(1 / 60);
  if (!strike) throw new Error('Fixture failed to collide');
  waves.drop(strike.x / 100, strike.y / 100, 0.07, 0.4);
  waves.update(1 / 60, []);
  const heights = read(waves);
  let weight = 0, x = 0, z = 0;
  heights.forEach((h, i) => {
    const w = Math.abs(h);
    weight += w;
    x += w * (((i % GRID) + 0.5) / GRID - 0.5) * 3;
    z += w * ((Math.floor(i / GRID) + 0.5) / GRID - 0.5) * 3;
  });
  const error = Math.hypot(x / weight - strike.x / 100, z / weight - strike.y / 100);
  check('Ripple starts at actual collision (within one grid cell)', error < 3 / GRID, {error});
  check('Positive impact is not inverted by integration', sample(heights, strike.x / 100, strike.y / 100) > 0, sample(heights, strike.x / 100, strike.y / 100));
  const initialEnergy = heights.reduce((s, h) => s + h * h, 0);
  for (let i = 0; i < 180; i++) waves.update(1 / 60, []);
  const settled = read(waves);
  const energy = settled.reduce((s, h) => s + h * h, 0);
  check('Unforced waves stay finite and dissipate', Number.isFinite(energy) && energy < initialEnergy * 0.2, {initialEnergy, energy});
  waves.dispose();

  const wake = new Waves(renderer, 1.5);
  check('New water is flat', read(wake).every(h => h === 0), Math.max(...read(wake)));
  wake.update(1 / 60, [[0, 0, 0.1]]);
  check('Stationary bowl creates no waves', read(wake).every(h => h === 0), {peak: Math.max(...read(wake)), was: wake.was[0].toArray(), now: wake.now[0].toArray()});
  wake.update(1 / 60, [[0.01, 0, 0.1]]);
  const field = read(wake);
  check('Moving bowl raises water ahead and lowers it behind', sample(field, 0.09, 0) > 0 && sample(field, -0.08, 0) < 0, {front: sample(field, 0.09, 0), back: sample(field, -0.08, 0)});
  wake.drop(0.5, 0.5, 0.07, 0.4);
  wake.resetBowls();
  check('Replacing bowls clears pending impacts', wake.drops.length === 0, wake.drops.length);
  wake.dispose();

  for (const [da, db] of [[12, 36], [36, 12], [20, 20]]) {
    const [ra, rb] = contactRadii(da, db);
    sim.bowls = [
      {...bowl(0, 0, 10), d: da, r: da / 2, m: (da / 2) ** 2},
      {...bowl(1, ra + rb - 0.01, -10), d: db, r: db / 2, m: (db / 2) ** 2},
    ];
    const [a, b] = sim.bowls;
    const before = a.m * a.vx + b.m * b.vx;
    // A fresh simulation avoids the same-pair audio cooldown between fixtures.
    const contact = new Sim(0);
    contact.bowls = sim.bowls;
    const [s] = contact.step(0);
    check(`Curved bowl contact ${da}/${db} cm`, !!s && Math.abs(s.x - (a.x + ra)) < 1e-9 && Math.abs(s.x - (b.x - rb)) < 1e-9, {contact: s?.x, aSurface: a.x + ra, bSurface: b.x - rb});
    check(`Collision conserves momentum ${da}/${db} cm`, Math.abs(before - (a.m * a.vx + b.m * b.vx)) < 1e-8, {before, after: a.m * a.vx + b.m * b.vx});
  }
  renderer.dispose();
  return {pass: results.every(r => r.pass), results};
}
