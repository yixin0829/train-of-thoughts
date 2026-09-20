import * as THREE from "three";

import type { Bowl } from "@/lib/sim";
import { HEIGHT, WALL, DRAFT } from "@/lib/bowl-shape";
export { WATERLINE } from "@/lib/bowl-shape";

/** Bowls live on their own layer, so the view through the water can leave them out. */
export const BOWL_LAYER = 1;


/**
 * Half a bowl's cross-section for a unit diameter, turned on a lathe: the foot ring, an
 * outer wall that leaves the foot flat and rises to vertical at the rim, a rounded lip,
 * and the inner wall back down to the well.
 */
function profile() {
  const pts: THREE.Vector2[] = [];
  const foot = 0.2;
  const rise = 0.03;
  const v = (r: number, y: number) => pts.push(new THREE.Vector2(r, y));
  v(0, rise - 0.006);
  v(foot - 0.03, rise - 0.006);
  v(foot - 0.02, 0);
  v(foot + 0.01, 0);
  v(foot + 0.02, rise);
  const wall = (inset: number, from: number, to: number) => {
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const th = (from + ((to - from) * i) / steps) * (Math.PI / 2);
      v(foot + 0.02 + (0.5 - foot - 0.02 - inset) * Math.sin(th), rise + inset + (HEIGHT - rise - inset) * (1 - Math.cos(th)));
    }
  };
  wall(0, 0.02, 1);
  v(0.5 - WALL / 2, HEIGHT + WALL * 0.45); // the lip
  wall(WALL, 1, 0.02);
  v(0, rise + WALL);
  return pts;
}

/**
 * The lathe mesh, with vertex colours standing in for light that doesn't reach into the well:
 * the steep inner wall darkens and warms toward the rim while the floor of the well stays
 * light, so against the bright lip the bowl reads as hollow from above.
 */
export function bowlGeometry() {
  const pts = profile();
  const g = new THREE.LatheGeometry(pts, 72);
  const lip = pts.findIndex((p) => p.y > HEIGHT);
  const deep = new THREE.Color("#a48d74");
  const white = new THREE.Color("#ffffff");
  const c = new THREE.Color();
  const colors: number[] = [];
  const perRing = pts.length;
  for (let i = 0; i < g.attributes.position.count; i++) {
    const p = pts[i % perRing];
    const inside = i % perRing > lip;
    const wall = inside ? THREE.MathUtils.smoothstep(p.x, 0.22, 0.49) : 0;
    c.copy(white).lerp(deep, wall * 0.85);
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

export function porcelain() {
  return new THREE.MeshPhysicalMaterial({
    color: "#f4eee4",
    vertexColors: true,
    roughness: 0.22,
    clearcoat: 0.6,
    clearcoatRoughness: 0.12,
    side: THREE.DoubleSide,
  });
}

/**
 * The 3D half of a bowl. The simulation moves it across the water in 2D; this adds what the
 * water does to it on the spot: a slow bob, and a tip and a spin when it is struck, each on
 * a damped spring. None of it feeds back into the simulation.
 */
export class BowlMesh {
  readonly mesh: THREE.Mesh;
  private phase = Math.random() * Math.PI * 2;
  private tilt = new THREE.Vector2();
  private tiltV = new THREE.Vector2();
  private yaw = Math.random() * Math.PI * 2;
  private yawV = (Math.random() - 0.5) * 0.1;
  private dip = 0;
  private dipV = 0;

  constructor(
    readonly bowl: Bowl,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ) {
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.layers.set(BOWL_LAYER);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true; // the rim shades the well
    this.mesh.scale.setScalar(bowl.d / 100);
    this.mesh.userData.bowl = bowl;
  }

  /** A strike pushing the bowl along (nx, ny) in the water plane, hit in [0, 1]. */
  kick(nx: number, ny: number, hit: number) {
    const k = hit * 1.6;
    // it dips toward where it's pushed
    this.tiltV.x += ny * k;
    this.tiltV.y -= nx * k;
    this.yawV += (Math.random() - 0.5) * hit * 1.5;
    this.dipV -= hit * 0.05;
  }

  update(dt: number, time: number) {
    const b = this.bowl;
    // a floating bowl is an underdamped spring in tilt and heave
    this.tiltV.addScaledVector(this.tilt, -28 * dt).multiplyScalar(1 - 2.2 * dt);
    this.tilt.addScaledVector(this.tiltV, dt);
    this.dipV += (-40 * this.dip - 4 * this.dipV) * dt;
    this.dip += this.dipV * dt;
    this.yawV *= 1 - 0.6 * dt;
    this.yaw += this.yawV * dt;

    const size = b.d / 100;
    const swell = Math.sin(time * 0.9 + this.phase) * 0.003;
    const rock = 0.02 * Math.sin(time * 0.7 + this.phase * 1.7);
    this.mesh.position.set(b.x / 100, -DRAFT * HEIGHT * size + swell + this.dip * size, b.y / 100);
    // spin about the bowl's own axis first, then tip it in world space
    this.mesh.rotation.set(this.tilt.x + rock, this.yaw, this.tilt.y - rock * 0.6, "XZY");
  }
}
