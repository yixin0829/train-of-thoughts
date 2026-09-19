"use client";

import { AdaptiveDpr, Line, OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import type { Volume } from "@/lib/extract-frames";

export type Range = [number, number];
export type Cuts = { x: Range; y: Range; t: Range };
/** How opaque the haze is when looking straight through the whole clip, and the active frame's opacity. */
export type Opacity = { haze: number; frame: number };

/** Length of the time axis in world units; a frame is 1 unit tall. */
const TIME_LENGTH = 1.6;
/** How much a freshly cut face stands out from the haze. */
const CUT_SURFACE = 0.3;
/** Opacity of the whole cube once the clip has played through once. */
const PLAYED = 0.9;

const vertexShader = /* glsl */ `
  out vec3 vPos;
  void main() {
    vPos = position + 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Everything happens in box space p ∈ [0,1]³: x → right, y → up, z → toward the
// viewer. Time runs into the screen, so t = 1 − z and the first frame faces you.
const fragmentShader = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  uniform sampler3D uVolume;
  uniform sampler2D uFrame;
  uniform vec3 uVoxels;
  uniform vec3 uMin;
  uniform vec3 uMax;
  uniform float uActive;
  uniform vec3 uCamera;
  uniform vec3 uScale;
  uniform vec3 uBg;
  uniform float uHaze;
  uniform float uCutSurface;
  uniform float uActiveAlpha;
  uniform float uOpacity;

  in vec3 vPos;
  out vec4 fragColor;

  vec4 sampleVolume(vec3 p) {
    return texture(uVolume, vec3(p.x, 1.0 - p.y, 1.0 - p.z));
  }

  void over(inout vec4 acc, vec3 color, float alpha) {
    acc.rgb += (1.0 - acc.a) * alpha * color;
    acc.a += (1.0 - acc.a) * alpha;
  }

  void main() {
    vec3 ro = uCamera;
    vec3 rd = normalize(vPos - ro);

    // slab test against the cut box
    vec3 inv = 1.0 / rd;
    vec3 t0 = (uMin - ro) * inv;
    vec3 t1 = (uMax - ro) * inv;
    vec3 tn = min(t0, t1);
    vec3 tf = max(t0, t1);
    float tEnter = max(max(tn.x, tn.y), max(tn.z, 0.0));
    float tExit = min(min(tf.x, tf.y), tf.z);
    if (tExit <= tEnter) discard;

    // the active frame is a plane of constant z that stops the ray
    float tEnd = tExit;
    bool hitsActive = false;
    if (uActive >= 0.0 && abs(rd.z) > 1e-5) {
      float ta = (uActive - ro.z) / rd.z;
      if (ta >= tEnter - 1e-4 && ta <= tExit) {
        tEnd = max(ta, tEnter);
        hitsActive = true;
      }
    }

    vec4 acc = vec4(0.0);

    // entering through a cut face (rather than the clip's own skin): show it as a surface
    vec3 pe = ro + rd * tEnter;
    const float eps = 1e-3;
    float onCut = dot(step(abs(pe - uMin), vec3(eps)) * step(eps, uMin), vec3(1.0))
                + dot(step(abs(pe - uMax), vec3(eps)) * step(uMax, vec3(1.0 - eps)), vec3(1.0));
    if (onCut > 0.0 && tEnd - tEnter > 1e-4) {
      over(acc, sampleVolume(pe).rgb, uCutSurface);
    }

    // translucent haze of every other frame: about one step per voxel crossed, within a budget
    const int MAX_STEPS = 112;
    int steps = clamp(int(ceil(length((tEnd - tEnter) * rd * uVoxels))), 16, MAX_STEPS);
    float dt = (tEnd - tEnter) / float(steps);
    // fraction of the full clip depth covered by one step, so opacity is view-independent
    float exposure = length(rd * uScale) * dt / uScale.z;
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= steps) break;
      vec3 p = ro + rd * (tEnter + (float(i) + jitter) * dt);
      vec3 c = sampleVolume(p).rgb;
      // pixels that differ from the paper carry more ink
      float weight = 0.35 + 0.65 * min(distance(c, uBg), 1.0);
      float a = 1.0 - pow(1.0 - clamp(uHaze * weight, 0.0, 0.99), exposure);
      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      over(acc, mix(vec3(luma), c, 0.65), a);
      if (acc.a > 0.97) break;
    }

    // the active frame comes from the source video at full resolution
    if (hitsActive) {
      vec3 p = ro + rd * tEnd;
      over(acc, texture(uFrame, p.xy).rgb, uActiveAlpha);
    }

    fragColor = acc * uOpacity;
  }
`;

function readThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return { paper: read("--background"), ink: read("--foreground") };
}

function useThemeColors() {
  const [colors, setColors] = useState(readThemeColors);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setColors(readThemeColors());
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return colors;
}

/** Lucide's move-horizontal in ink, haloed in paper so it reads on any background. */
const SLIDER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="m18 8 4 4-4 4M2 12h20M6 8l-4 4 4 4" stroke="#f3efe6" stroke-width="4"/>
    <path d="m18 8 4 4-4 4M2 12h20M6 8l-4 4 4 4" stroke="#1c1b19" stroke-width="2"/>
  </svg>`,
)}") 12 12, ew-resize`;

/** Hex colour → raw sRGB components, matching the unconverted bytes in the volume. */
function srgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return new THREE.Vector3((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

type VolumeMeshProps = {
  volume: Volume;
  cuts: Cuts;
  active: number;
  playing: boolean;
  opacity: Opacity;
  onActiveChange: (active: number) => void;
  onPlayingChange: (playing: boolean) => void;
};

function VolumeMesh({ volume, cuts, active, playing, opacity, onActiveChange, onPlayingChange }: VolumeMeshProps) {
  const mesh = useRef<THREE.Mesh>(null);
  const colors = useThemeColors();
  const scale = useMemo(
    () => new THREE.Vector3(volume.width / volume.height, 1, TIME_LENGTH),
    [volume],
  );

  const texture = useMemo(() => {
    const tex = new THREE.Data3DTexture(volume.data, volume.width, volume.height, volume.depth);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    return tex;
  }, [volume]);
  useEffect(() => () => texture.dispose(), [texture]);

  // the source video as a plain texture, re-uploaded only when it shows a new picture
  const frame = useMemo(() => {
    const tex = new THREE.Texture(volume.video);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }, [volume]);
  useEffect(() => () => frame.dispose(), [frame]);
  const frameDirty = useRef(true);
  useEffect(() => {
    const markDirty = () => (frameDirty.current = true);
    volume.video.addEventListener("seeked", markDirty);
    return () => volume.video.removeEventListener("seeked", markDirty);
  }, [volume]);
  // the frame loop drives the video imperatively, so it reaches both through a ref
  const playback = useRef({ video: volume.video, frame });
  useEffect(() => {
    playback.current = { video: volume.video, frame };
  }, [volume, frame]);
  // true while this component has the video playing
  const session = useRef(false);
  // the first play-through runs to the end; after it, the cube rests slightly faded
  const [played, setPlayed] = useState(false);
  // true while a hover interrupts the first play-through, which resumes when the pointer leaves
  const hoverPaused = useRef(false);
  useEffect(() => {
    if (playing) hoverPaused.current = false;
  }, [playing]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        uniforms: {
          uVolume: { value: null },
          uFrame: { value: null },
          uVoxels: { value: new THREE.Vector3() },
          uMin: { value: new THREE.Vector3() },
          uMax: { value: new THREE.Vector3(1, 1, 1) },
          uActive: { value: -1 },
          uCamera: { value: new THREE.Vector3() },
          uScale: { value: new THREE.Vector3() },
          uBg: { value: new THREE.Vector3() },
          uHaze: { value: 0 },
          uCutSurface: { value: CUT_SURFACE },
          uActiveAlpha: { value: 0 },
          uOpacity: { value: 1 },
        },
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  // active 0..1 runs from the first sampled frame's centre to the last's
  const activeT = THREE.MathUtils.clamp((active * (volume.depth - 1) + 0.5) / volume.depth, cuts.t[0], cuts.t[1]);
  const activeVisible = active >= cuts.t[0] - 1e-6 && active <= cuts.t[1] + 1e-6;

  useFrame(({ camera }, delta) => {
    if (!mesh.current) return;
    const { video, frame } = playback.current;
    const { span } = volume;

    if (playing) {
      const [start, end] = cuts.t;
      if (!session.current) {
        // (re)start from wherever the playhead rests, or from the top of the t range when it rests outside
        session.current = true;
        const from = active >= start && active < end ? active : start;
        video.currentTime = from * span;
        void video.play();
        onActiveChange(from);
      } else {
        // play through the t range once, then rest on its last frame
        const now = video.currentTime / span;
        if (video.ended || now >= end) {
          // the session stays open until `playing` turns false; a frame that still sees the old
          // `playing` then repeats this instead of restarting from a stale playhead
          video.pause();
          setPlayed(true);
          onActiveChange(end);
          onPlayingChange(false);
        } else {
          onActiveChange(Math.max(start, now));
        }
      }
    } else {
      if (session.current) {
        session.current = false;
        video.pause();
      }
      // follow the playhead while scrubbing, one seek at a time
      const target = active * span;
      if (!video.seeking && Math.abs(video.currentTime - target) > span / (volume.depth - 1) / 2) {
        video.currentTime = target;
      }
    }

    if ((!video.paused || frameDirty.current) && video.readyState >= video.HAVE_CURRENT_DATA) {
      frame.needsUpdate = true;
      frameDirty.current = false;
    }

    const u = (mesh.current.material as THREE.ShaderMaterial).uniforms;
    u.uVolume.value = texture;
    u.uFrame.value = frame;
    u.uVoxels.value.set(volume.width, volume.height, volume.depth);
    u.uScale.value.copy(scale);
    u.uMin.value.set(cuts.x[0], cuts.y[0], 1 - cuts.t[1]);
    u.uMax.value.set(cuts.x[1], cuts.y[1], 1 - cuts.t[0]);
    u.uActive.value = activeVisible ? 1 - activeT : -1;
    u.uBg.value.copy(srgb(colors.paper));
    u.uHaze.value = opacity.haze;
    u.uActiveAlpha.value = opacity.frame;
    u.uOpacity.value = THREE.MathUtils.damp(u.uOpacity.value, played ? PLAYED : 1, 3, delta);
    u.uCamera.value.copy(mesh.current.worldToLocal(camera.position.clone())).addScalar(0.5);
  });

  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(scale.x, scale.y, scale.z)), [scale]);
  useEffect(() => () => edges.dispose(), [edges]);

  // the active frame's border, clipped to the x/y cuts
  const toWorld = (p: number, size: number) => (p - 0.5) * size;
  const z = toWorld(1 - activeT, scale.z);
  const [x0, x1] = cuts.x.map((v) => toWorld(v, scale.x));
  const [y0, y1] = cuts.y.map((v) => toWorld(v, scale.y));
  const border: [number, number, number][] = [
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
    [x0, y0, z],
  ];

  // Scrubbing: grab the active frame and slide it along the time axis as it appears on screen.
  const get = useThree((state) => state.get);
  const grab = useRef<{ x: number; y: number } | null>(null);
  const setCursor = (cursor: string) => {
    get().gl.domElement.style.cursor = cursor;
  };

  const slideTo = (e: ThreeEvent<PointerEvent>) => {
    if (!grab.current) return;
    const { x, y } = grab.current;
    const [start, end] = cuts.t;
    const { width, height } = get().size;
    const aspect = width / height;
    const toScreen = (t: number) => {
      const v = new THREE.Vector3(x, y, (0.5 - t) * scale.z).project(e.camera);
      return new THREE.Vector2(v.x * aspect, v.y);
    };
    const a = toScreen(start);
    const along = toScreen(end).sub(a);
    // looking straight down the time axis: there is no direction to slide in
    if (along.lengthSq() < 1e-6) return;
    const pointer = new THREE.Vector2(e.pointer.x * aspect, e.pointer.y).sub(a);
    const f = THREE.MathUtils.clamp(pointer.dot(along) / along.lengthSq(), 0, 1);
    onActiveChange(start + f * (end - start));
  };

  const release = () => {
    grab.current = null;
    const controls = get().controls as { enabled: boolean } | null;
    if (controls) controls.enabled = true;
  };

  return (
    <group>
      <mesh
        ref={mesh}
        scale={scale}
        material={material}
        onPointerOver={() => {
          if (!playing) return;
          hoverPaused.current = !played;
          onPlayingChange(false);
        }}
        onPointerOut={() => {
          if (!hoverPaused.current) return;
          hoverPaused.current = false;
          onPlayingChange(true);
        }}
      >
        <boxGeometry />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={colors.ink} transparent opacity={0.15} />
      </lineSegments>
      {activeVisible && (
        <>
          <Line points={border} color={colors.ink} transparent opacity={0.65} lineWidth={1} />
          {/* an invisible handle over the active frame */}
          <mesh
            position={[(x0 + x1) / 2, (y0 + y1) / 2, z]}
            scale={[x1 - x0, y1 - y0, 1]}
            onPointerOver={() => setCursor(SLIDER_CURSOR)}
            onPointerOut={() => {
              if (!grab.current) setCursor("");
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as Element).setPointerCapture(e.pointerId);
              // hold the camera still while the frame slides
              const controls = get().controls as { enabled: boolean } | null;
              if (controls) controls.enabled = false;
              grab.current = { x: e.point.x, y: e.point.y };
              // scrubbing is deliberate: leaving the cube afterwards does not resume
              hoverPaused.current = false;
              onPlayingChange(false);
            }}
            onPointerMove={slideTo}
            onPointerUp={(e) => {
              (e.target as Element).releasePointerCapture(e.pointerId);
              release();
            }}
            onLostPointerCapture={release}
          >
            <planeGeometry />
            <meshBasicMaterial side={THREE.DoubleSide} transparent opacity={0} depthWrite={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

type VideoCubeProps = VolumeMeshProps & { resetKey: number };

export default function VideoCube({ resetKey, ...props }: VideoCubeProps) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  useEffect(() => {
    if (resetKey) controls.current?.reset();
  }, [resetKey]);

  return (
    <Canvas
      flat
      dpr={[1, 2]}
      performance={{ min: 0.5 }}
      camera={{ position: [2.9, 1.6, 4.2], fov: 30 }}
      gl={{ antialias: true, alpha: true }}
    >
      <VolumeMesh {...props} />
      {/* drop to a coarser resolution while the camera moves, then sharpen at rest */}
      <AdaptiveDpr />
      <OrbitControls ref={controls} makeDefault regress enableDamping dampingFactor={0.08} minDistance={1.5} maxDistance={14} />
    </Canvas>
  );
}
