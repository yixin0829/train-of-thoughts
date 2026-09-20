import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import type { Chimes } from "@/lib/audio";
import { BOWL_LAYER, BowlMesh, bowlGeometry, porcelain, WATERLINE } from "@/lib/scene/bowl";
import { buildPool, COLORS, RADIUS } from "@/lib/scene/water";
import { Waves } from "@/lib/scene/waves";
import { type Bowl, Sim, type Strike } from "@/lib/sim";

/** Where the eye starts: a person standing at the pool's edge, looking in and down (67° from vertical). */
const HOME = new THREE.Vector3(0, 1.53, 3.73);
/** On a tall screen, a view from further overhead, so the round pool fills the width. */
const HOME_TALL = new THREE.Vector3(0, 3.4, 1.6);
/** Half the width the start view must hold: the pool and its coping, metres. */
const HOLD = 1.7;
/** The skylight, well off vertical so a bowl's shadow lands clear of it on the lining. */
const LIGHT = new THREE.Vector3(1.5, 3.4, 1.1);
/** Small, shared steps keep impacts and water in sync even on slower displays. */
const STEP = 1 / 120;

/**
 * The whole 3D pool, in plain three.js: renderer, camera, controls, the simulation and the
 * loop that joins them. React creates one per mount, feeds it settings, and disposes it.
 */
export class PoolScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.05, 80);
  private controls: OrbitControls;
  private pool: ReturnType<typeof buildPool>;
  private waves: Waves;
  private geometry = bowlGeometry();
  private material = porcelain();
  private envMap: THREE.Texture;
  private sim = new Sim(0);
  private meshes = new Map<Bowl, BowlMesh>();
  private chimes: Chimes | null = null;
  private frame = 0;
  private last = performance.now();
  private owed = 0;
  private time = 0;
  private resizer: ResizeObserver;

  private raycaster = new THREE.Raycaster();
  private waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private held: { bowl: Bowl; pointer: number } | null = null;
  /** HOME, pulled back on narrow screens so the whole pool fits */
  private home = HOME.clone();

  constructor(
    private host: HTMLElement,
    private onStrike: (strike: Strike) => void,
  ) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false; // each frame draws twice (see buildPool's render); shadows once
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.32;
    this.scene.background = new THREE.Color(COLORS.hall);
    this.scene.fog = new THREE.Fog(COLORS.hall, 6, 22);

    // skylight from the vault, casting the bowls' shadows onto the lining
    const sun = new THREE.DirectionalLight("#fff4e6", 1.9);
    sun.position.copy(LIGHT);
    sun.castShadow = true;
    sun.shadow.camera.layers.enable(BOWL_LAYER);
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -2;
    sun.shadow.camera.right = sun.shadow.camera.top = 2;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 8;
    sun.shadow.radius = 4;
    sun.shadow.blurSamples = 16;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.003;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight("#fff8ee", COLORS.hall, 0.22));

    this.camera.layers.enable(BOWL_LAYER);
    this.raycaster.layers.enable(BOWL_LAYER);
    this.pool = buildPool(LIGHT);
    this.scene.add(this.pool.group);
    this.waves = new Waves(renderer, RADIUS);

    const controls = new OrbitControls(this.camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.2;
    controls.maxDistance = 9;
    controls.minPolarAngle = 0.05;
    controls.maxPolarAngle = 1.4; // never below the water
    this.controls = controls;

    const el = renderer.domElement;
    el.addEventListener("pointerdown", this.onDown, { capture: true });
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);

    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(host);
    this.resize();
    this.resetView();
    this.frame = requestAnimationFrame(this.tick);
  }

  /** Put `count` bowls on the water, replacing the ones there. */
  setCount(count: number) {
    this.sim.place(count);
    for (const m of this.meshes.values()) this.scene.remove(m.mesh);
    this.meshes.clear();
    for (const b of this.sim.bowls) {
      const m = new BowlMesh(b, this.geometry, this.material);
      this.meshes.set(b, m);
      this.scene.add(m.mesh);
    }
    this.held = null;
    this.controls.enabled = true;
    this.waves.resetBowls();
  }

  setCurrent(current: number) {
    this.sim.current = current;
  }

  /** The water only moves once there is sound to hear it by. */
  setChimes(chimes: Chimes | null) {
    this.chimes = chimes;
  }

  resetView() {
    this.camera.position.copy(this.home);
    this.controls.target.set(0, -0.05, 0);
    this.controls.update();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizer.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onDown, { capture: true });
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onUp);
    this.controls.dispose();
    this.pool.dispose();
    this.waves.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.envMap.dispose();
    this.renderer.dispose();
    el.remove();
  }

  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, w < 640 ? 1.5 : 2));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    const aspect = w / h;
    this.camera.aspect = aspect;
    // on a tall phone screen, look from higher, widen the view a little and step back until the pool fits across
    this.camera.fov = aspect < 1 ? 50 : 38;
    this.camera.updateProjectionMatrix();
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * aspect;
    const home = aspect < 1 ? HOME_TALL : HOME;
    this.home.copy(home).setLength(Math.max(home.length(), HOLD / halfWidth));
  }

  private tick = (now: number) => {
    this.frame = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.owed += dt;
    while (this.owed + 1e-9 >= STEP) {
      this.owed = Math.max(0, this.owed - STEP);
      this.time += STEP;
      if (this.chimes) for (const s of this.sim.step(STEP)) this.strike(s);
      for (const m of this.meshes.values()) m.update(STEP, this.time);
      const circles = this.sim.bowls.map((b): [number, number, number] => [b.x / 100, b.y / 100, (WATERLINE * b.d) / 100]);
      this.waves.update(STEP, circles);
    }
    this.pool.time.value = this.time;
    const circles = this.sim.bowls.map((b): [number, number, number] => [b.x / 100, b.y / 100, (WATERLINE * b.d) / 100]);
    this.pool.setBowls(circles);
    this.pool.height.value = this.waves.texture;
    this.controls.update();
    this.pool.render(this.renderer, this.scene, this.camera);
  };

  private strike(s: Strike) {
    const nx = s.b.x - s.a.x;
    const ny = s.b.y - s.a.y;
    const len = Math.hypot(nx, ny) || 1;
    this.meshes.get(s.a)?.kick(-nx / len, -ny / len, s.hit * (s.b.m / (s.a.m + s.b.m)));
    this.meshes.get(s.b)?.kick(nx / len, ny / len, s.hit * (s.a.m / (s.a.m + s.b.m)));
    this.waves.drop(s.x / 100, s.y / 100, 0.05 + 0.04 * s.hit, 0.15 + 0.6 * s.hit);

    if (this.chimes) {
      // place the sound where the strike is on screen
      const pan = new THREE.Vector3(s.x / 100, 0, s.y / 100).project(this.camera).x * 0.8;
      this.chimes.strike(s.a, s.a.voice, s.hit, pan);
      this.chimes.strike(s.b, s.b.voice, s.hit * 0.9, pan);
    }
    this.onStrike(s);
  }

  // ---------- dragging a bowl ----------

  private pointerRay(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster;
  }

  private bowlUnder(e: PointerEvent) {
    const hits = this.pointerRay(e).intersectObjects([...this.meshes.values()].map((m) => m.mesh), false);
    return (hits[0]?.object.userData.bowl as Bowl | undefined) ?? null;
  }

  /** Where the pointer meets the water, or null when it points at or above the horizon. */
  private waterPoint(e: PointerEvent) {
    const ray = this.pointerRay(e).ray;
    if (ray.direction.y > -0.02) return null; // a grazing ray meets the plane a mile away
    return ray.intersectPlane(this.waterPlane, new THREE.Vector3());
  }

  // capture phase, so a grab wins over OrbitControls' own listener
  private onDown = (e: PointerEvent) => {
    if (!this.chimes || e.button !== 0) return;
    const bowl = this.bowlUnder(e);
    const at = bowl && this.waterPoint(e);
    if (!bowl || !at) return;
    e.stopImmediatePropagation();
    this.sim.pull(bowl, at.x * 100, at.z * 100);
    this.held = { bowl, pointer: e.pointerId };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = "grabbing";
  };

  private onMove = (e: PointerEvent) => {
    const el = this.renderer.domElement;
    if (!this.held) {
      if (e.pointerType === "mouse") el.style.cursor = this.chimes && this.bowlUnder(e) ? "grab" : "";
      return;
    }
    if (e.pointerId !== this.held.pointer) return;
    const at = this.waterPoint(e);
    if (at) this.sim.pull(this.held.bowl, at.x * 100, at.z * 100);
  };

  private onUp = (e: PointerEvent) => {
    if (!this.held || e.pointerId !== this.held.pointer) return;
    this.sim.release(this.held.bowl);
    this.held = null;
    this.controls.enabled = true;
    this.renderer.domElement.style.cursor = "";
  };
}
