import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/** Grid cells across the pool; one cell is about 1.2 cm of water. */
export const GRID = 256;
/** Simulation steps per second, independent of the frame rate. */
const RATE = 60;
/** Most strikes waiting to drop into the water between steps. */
const MAX_DROPS = 8;
/** Most bowls pushing water about (the slider's maximum). */
const MAX_BOWLS = 48;

// Wave equation on a height field, after Evan Wallace's WebGL Water. Each texel holds
// (height, velocity). Each step accelerates toward the old neighbours' average, then adds
// raised-cosine impact drops and water shoved aside by moving bowls (new footprint minus
// old: a bow wave ahead and a trough behind). Outside the pool the water is pinned flat,
// so waves reflect off the wall.
const stepShader = /* glsl */ `
  uniform sampler2D uState;
  uniform vec2 uTexel;
  uniform vec4 uDrops[${MAX_DROPS}];       // uv, radius (uv), strength
  uniform vec4 uBowlsWas[${MAX_BOWLS}];    // uv, radius (uv), 0 when unused
  uniform vec4 uBowlsNow[${MAX_BOWLS}];
  uniform float uWake;
  varying vec2 vUv;

  float footprint(vec4 b) {
    if (b.z <= 0.0) return 0.0;
    // a soft footprint, so a sudden move (a collision, a grab) makes a swell, not a sharp ring
    return 1.0 - smoothstep(b.z * 0.3, b.z * 1.3, distance(vUv, b.xy));
  }

  void main() {
    vec4 s = texture2D(uState, vUv);
    // Integrate one consistent snapshot. Adding a drop to s.r before this stencil
    // compares the new centre with OLD neighbours and immediately inverts the drop.
    float avg = 0.25 * (
      texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r + texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r +
      texture2D(uState, vUv - vec2(0.0, uTexel.y)).r + texture2D(uState, vUv + vec2(0.0, uTexel.y)).r);
    s.g += (avg - s.r) * 1.2;
    s.g *= 0.985;
    s.r += s.g;

    for (int i = 0; i < ${MAX_DROPS}; i++) {
      vec4 d = uDrops[i];
      if (d.z <= 0.0) continue;
      float k = max(0.0, 1.0 - distance(vUv, d.xy) / d.z);
      s.r += (0.5 - 0.5 * cos(k * 3.14159265)) * d.w;
    }
    for (int i = 0; i < ${MAX_BOWLS}; i++) s.r += uWake * (footprint(uBowlsNow[i]) - footprint(uBowlsWas[i]));
    if (length(vUv * 2.0 - 1.0) > 1.0) s.rg = vec2(0.0);
    gl_FragColor = s;
  }
`;

/**
 * The water's surface as a simulated height field on the GPU, covering the square around
 * the pool. `texture` is read by the water shader (normals, refraction) and the lining
 * (caustics). World (x, z) in metres maps to uv = (x, z) / (2 · radius) + 0.5.
 */
export class Waves {
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private quad: FullScreenQuad;
  private material: THREE.ShaderMaterial;
  private drops: THREE.Vector4[] = [];
  private was: THREE.Vector4[];
  private now: THREE.Vector4[];
  private owed = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private radius: number,
  ) {
    const make = () =>
      new THREE.WebGLRenderTarget(GRID, GRID, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
      });
    this.targets = [make(), make()];
    this.was = Array.from({ length: MAX_BOWLS }, () => new THREE.Vector4(0, 0, 0, 0));
    this.now = Array.from({ length: MAX_BOWLS }, () => new THREE.Vector4(0, 0, 0, 0));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uState: { value: null },
        uTexel: { value: new THREE.Vector2(1 / GRID, 1 / GRID) },
        uDrops: { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4()) },
        uBowlsWas: { value: this.was },
        uBowlsNow: { value: this.now },
        uWake: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: stepShader,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
    // start from still water
    const clear = new THREE.Color(0, 0, 0);
    for (const t of this.targets) {
      renderer.setRenderTarget(t);
      renderer.setClearColor(clear, 0);
      renderer.clear();
    }
    renderer.setRenderTarget(null);
  }

  get texture() {
    return this.targets[0].texture;
  }

  /** A strike at (x, z) metres, strength ~ how hard. */
  drop(x: number, z: number, radius: number, strength: number) {
    if (this.drops.length < MAX_DROPS) this.drops.push(new THREE.Vector4(...this.uv(x, z), radius / (2 * this.radius), strength));
  }

  /**
   * Advance the water to now. `bowls` are the waterline circles (x, z, radius) in metres;
   * the water is shoved by how far each moved since the last step.
   */
  update(dt: number, bowls: [number, number, number][]) {
    this.owed = Math.min(this.owed + dt * RATE, 4);
    const u = this.material.uniforms;
    for (let i = 0; i < MAX_BOWLS; i++) {
      const b = bowls[i];
      if (b) this.now[i].set(...this.uv(b[0], b[1]), b[2] / (2 * this.radius), 1);
      else this.now[i].set(0, 0, 0, 0);
      // a bowl just placed hasn't moved yet
      if (this.was[i].w === 0) this.was[i].copy(this.now[i]);
    }
    const saved = this.renderer.getRenderTarget();
    while (this.owed >= 1) {
      this.owed -= 1;
      const drops = u.uDrops.value as THREE.Vector4[];
      drops.forEach((d, i) => d.copy(this.drops[i] ?? new THREE.Vector4()));
      this.drops = [];
      u.uWake.value = 0.06;
      u.uState.value = this.targets[0].texture;
      this.renderer.setRenderTarget(this.targets[1]);
      this.quad.render(this.renderer);
      this.targets.reverse();
      // the shove is the whole move since the last step; later steps this frame see none
      for (let i = 0; i < MAX_BOWLS; i++) this.was[i].copy(this.now[i]);
    }
    this.renderer.setRenderTarget(saved);
  }

  /** Forget where bowls were, e.g. after they are all replaced, so nothing sloshes. */
  resetBowls() {
    this.drops = [];
    for (const v of this.was) v.set(0, 0, 0, 0);
    for (const v of this.now) v.set(0, 0, 0, 0);
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    this.material.dispose();
    this.quad.dispose();
  }

  private uv(x: number, z: number): [number, number] {
    return [x / (2 * this.radius) + 0.5, z / (2 * this.radius) + 0.5];
  }
}
