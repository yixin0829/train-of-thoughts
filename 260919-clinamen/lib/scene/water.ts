import * as THREE from "three";

import { BOWL_LAYER } from "@/lib/scene/bowl";
import { GRID } from "@/lib/scene/waves";

/** Pool radius and depth in metres. */
export const RADIUS = 1.5;
const DEPTH = 0.32;
/** Most bowls the water knows about (the slider's maximum). */
export const MAX_BOWLS = 48;
/** Metres of water per unit of simulated height. */
const HEIGHT_SCALE = 0.01;

export const COLORS = {
  lining: "#3aa8d8",
  wall: "#2c8fc0",
  coping: "#e3d8c6",
  ground: "#2f353c",
  hall: "#1f2429",
};

/** Shared by the water and the lining: the simulated height field and how to read it. */
const heightGlsl = /* glsl */ `
  uniform sampler2D uHeight;
  uniform float uRadius;
  uniform float uTime;
  uniform vec3 uBowls[${MAX_BOWLS}]; // x, z, waterline radius
  const float CELL = 2.0 * ${RADIUS.toFixed(3)} / ${GRID}.0;

  vec2 heightUv(vec2 p) { return p / (2.0 * uRadius) + 0.5; }
  float waveHeight(vec2 uv) { return texture2D(uHeight, uv).r * ${HEIGHT_SCALE.toFixed(4)}; }

  // slope of the simulated waves plus a faint slow swell, so still water isn't glass
  vec2 slope(vec2 p) {
    vec2 uv = heightUv(p);
    vec2 t = vec2(1.0 / ${GRID}.0, 0.0);
    vec2 s = vec2(waveHeight(uv + t.xy) - waveHeight(uv - t.xy), waveHeight(uv + t.yx) - waveHeight(uv - t.yx)) / (2.0 * CELL);
    s += 0.0012 * vec2(3.1, 1.3) * cos(dot(p, vec2(3.1, 1.3)) + uTime * 0.7);
    s += 0.0009 * vec2(-1.7, 3.7) * cos(dot(p, vec2(-1.7, 3.7)) + uTime * 0.9);
    s += 0.0004 * vec2(9.3, -6.1) * cos(dot(p, vec2(9.3, -6.1)) - uTime * 1.6);
    return s;
  }
`;

const waterVertex = /* glsl */ `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// Normals come from the simulated surface. Looking through the water, the pool below (drawn
// first into uUnder) is offset by the slope, so the lining and shadows wobble under passing
// waves; at a glance the surface turns to a mirror of the hall.
const waterFragment = /* glsl */ `
  ${heightGlsl}
  uniform sampler2D uUnder;
  uniform vec2 uResolution;
  uniform vec3 uLightDir;
  uniform vec3 uSkyLow;
  uniform vec3 uSkyHigh;
  uniform vec3 uTint;
  varying vec3 vWorld;
  #include <fog_pars_fragment>

  void main() {
    vec2 p = vWorld.xz;
    // no water inside a floating bowl (faded over a few mm, not cut, so the edge doesn't
    // alias); a darker meniscus where it meets the porcelain
    float meniscus = 0.0;
    float open = 1.0;
    for (int i = 0; i < ${MAX_BOWLS}; i++) {
      vec3 b = uBowls[i];
      if (b.z <= 0.0) continue;
      float d = distance(p, b.xy);
      open = min(open, smoothstep(b.z, b.z + 0.004, d));
      meniscus = max(meniscus, 1.0 - smoothstep(b.z, b.z * 1.15, d));
    }
    if (open <= 0.0) discard;

    vec2 s = slope(p);
    vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
    vec3 v = normalize(cameraPosition - vWorld);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 r = reflect(-v, n);
    // the hall reflected: dim walls near the horizon, the bright skylit vault above
    vec3 sky = mix(uSkyLow, uSkyHigh, smoothstep(0.0, 0.7, r.y));
    float spec = pow(max(dot(r, uLightDir), 0.0), 600.0) * 2.0;

    vec2 screen = gl_FragCoord.xy / uResolution;
    vec3 below = texture2D(uUnder, screen - s * 0.08).rgb;
    below = mix(below, uTint, 0.12); // a little blue from the water itself

    vec3 color = mix(below, sky, fres) * (1.0 - 0.35 * meniscus) + spec;
    gl_FragColor = vec4(color, open);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

type Shared = {
  height: { value: THREE.Texture | null };
  time: { value: number };
  bowls: { value: THREE.Vector3[] };
};

function waterMaterial(lightDir: THREE.Vector3, shared: Shared, under: THREE.Texture) {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uRadius: { value: RADIUS },
        uUnder: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uLightDir: { value: lightDir.clone().normalize() },
        uSkyLow: { value: new THREE.Color("#2a3036") },
        uSkyHigh: { value: new THREE.Color("#efe9df") },
        uTint: { value: new THREE.Color("#1d86b8") },
      },
    ]),
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  // shared objects, assigned after the merge (which would clone them)
  m.uniforms.uHeight = shared.height;
  m.uniforms.uTime = shared.time;
  m.uniforms.uBowls = shared.bowls;
  m.uniforms.uUnder.value = under;
  return m;
}

/**
 * Light focused by the surface, painted onto the lining: where the simulated water is
 * convex it gathers light into bright lines, where concave it spreads it thin. A faint
 * procedural pattern underneath keeps still water from looking dead.
 */
function withCaustics(material: THREE.MeshStandardMaterial, shared: Shared, lightDir: THREE.Vector3) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.time;
    shader.uniforms.uHeight = shared.height;
    shader.uniforms.uBowls = shared.bowls;
    shader.uniforms.uRadius = { value: RADIUS };
    shader.uniforms.uLightDir = { value: lightDir.clone().normalize() };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCausticPos;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvCausticPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        ${heightGlsl}
        uniform vec3 uLightDir;
        varying vec3 vCausticPos;
        float ambientCaustic(vec2 p) {
          float c = 0.0;
          for (int i = 0; i < 3; i++) {
            float fi = float(i);
            vec2 q = p * (5.0 + fi * 2.3) + vec2(sin(uTime * 0.23 + fi), cos(uTime * 0.19 - fi)) * 2.0;
            c += abs(sin(q.x + sin(q.y * 1.3 + uTime * 0.4)) * sin(q.y + sin(q.x * 1.1 - uTime * 0.35)));
          }
          return pow(1.0 - c / 3.0, 6.0);
        }
        // read the surface where this point's sunlight came through, up along the light
        float waveCaustic(vec3 floorPos) {
          vec2 p = floorPos.xz + uLightDir.xz / uLightDir.y * -floorPos.y;
          vec2 uv = heightUv(p);
          vec2 t = vec2(1.0 / ${GRID}.0, 0.0);
          float lap = waveHeight(uv + t.xy) + waveHeight(uv - t.xy) + waveHeight(uv + t.yx) + waveHeight(uv - t.yx) - 4.0 * waveHeight(uv);
          return clamp(-lap / (CELL * CELL) * 2.2, -0.5, 2.5);
        }`,
      )
      // Caustics ride on the sunlight, not on the lining's colour: in a bowl's shadow there
      // is no sunlight to focus, so the pattern fades out with the shadow's own soft edge
      // instead of being cut by a circle, and the shadow stays dark.
      .replace(
        "#include <lights_fragment_end>",
        "#include <lights_fragment_end>\nreflectedLight.directDiffuse *= 1.0 + 2.5 * ambientCaustic(vCausticPos.xz) + waveCaustic(vCausticPos);",
      );
  };
  return material;
}

/**
 * The pool: a shallow drum with a blue lining, a pale coping, the water on top, and the hall
 * floor around it. Returns the group plus the handles the loop animates.
 */
export function buildPool(lightDir: THREE.Vector3) {
  const group = new THREE.Group();
  const shared: Shared = {
    height: { value: null },
    time: { value: 0 },
    bowls: { value: Array.from({ length: MAX_BOWLS }, () => new THREE.Vector3()) },
  };
  // the pool as seen before the water is drawn over it, for refraction; sized in render()
  const under = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const disposables: { dispose(): void }[] = [];
  const add = <T extends THREE.Object3D>(o: T) => (group.add(o), o);
  const track = <T extends { dispose(): void }>(d: T) => (disposables.push(d), d);

  track(under);
  const lining = track(withCaustics(new THREE.MeshStandardMaterial({ color: COLORS.lining, roughness: 0.9 }), shared, lightDir));
  const floor = add(new THREE.Mesh(track(new THREE.CircleGeometry(RADIUS, 96)), lining));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -DEPTH;
  floor.receiveShadow = true;

  const wallMat = track(new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.9, side: THREE.BackSide }));
  const wall = add(new THREE.Mesh(track(new THREE.CylinderGeometry(RADIUS, RADIUS, DEPTH, 96, 1, true)), wallMat));
  wall.position.y = -DEPTH / 2;
  wall.receiveShadow = true;

  const copingMat = track(new THREE.MeshStandardMaterial({ color: COLORS.coping, roughness: 0.7 }));
  // a slim rolled lip, just proud of the water
  const coping = add(new THREE.Mesh(track(new THREE.TorusGeometry(RADIUS + 0.008, 0.01, 8, 160)), copingMat));
  coping.rotation.x = Math.PI / 2;
  coping.position.y = 0.004;
  coping.castShadow = true;
  coping.receiveShadow = true;

  const groundMat = track(new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 0.95 }));
  const ground = add(new THREE.Mesh(track(new THREE.RingGeometry(RADIUS + 0.012, 40, 160, 1)), groundMat));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.002;
  ground.receiveShadow = true;

  const water = track(waterMaterial(lightDir, shared, under.texture));
  const surface = add(new THREE.Mesh(track(new THREE.CircleGeometry(RADIUS, 128)), water));
  surface.rotation.x = -Math.PI / 2;
  surface.renderOrder = 1;

  const bowls = shared.bowls.value;
  const size = new THREE.Vector2();
  return {
    group,
    time: shared.time,
    /** the current simulated height field; it changes texture every step */
    height: shared.height,
    /**
     * Draw the frame: the pool without its water or bowls into `under` (bowls would show as
     * ghost copies once the waves bend the view), then everything.
     */
    render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
      renderer.getDrawingBufferSize(size);
      if (under.width !== size.x || under.height !== size.y) under.setSize(size.x, size.y);
      water.uniforms.uResolution.value.copy(size);
      surface.visible = false;
      camera.layers.disable(BOWL_LAYER);
      renderer.setRenderTarget(under);
      renderer.render(scene, camera); // with the shadows drawn for the previous frame
      camera.layers.enable(BOWL_LAYER);
      surface.visible = true;
      // three tests a caster against the *view* camera's layers, so the shadows have to be
      // drawn in this pass, the one that can see the bowls
      renderer.shadowMap.needsUpdate = true;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    },
    /** Where the water meets each bowl: (x, z, radius) in metres; the rest are cleared. */
    setBowls(circles: [number, number, number][]) {
      bowls.forEach((b, i) => (i < circles.length ? b.set(...circles[i]) : b.set(0, 0, 0)));
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
