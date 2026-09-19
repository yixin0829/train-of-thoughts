# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

clinamen: porcelain bowls drift on a 3D pool of water and ring when they collide, their pitch set by size. Nothing is composed — the sound is a side effect of a physics simulation, so a change to the physics is a change to the music.

One self-contained project inside the `train-of-thoughts` mono repo, a sibling of `260918-xy-plus-t`, whose stack and conventions it follows.

Stack: Next.js 16 (App Router, Turbopack), React 19 with the React Compiler lint rules, Bun, Tailwind v4, shadcn/ui on **Base UI** (`cn` comes from the `cn` package), and **plain three.js** — no react-three-fiber, unlike its sibling.

## Commands

```sh
bun install
bun run dev        # http://localhost:3000
bun run build
bun run lint
bunx tsc --noEmit  # typecheck; there is no test suite
```

Check visual and audio work by running the app and looking at it, not by reasoning about the shaders.

## Layout

| file | what it owns |
|---|---|
| `app/page.tsx` | all UI state, and the `Chimes` audio engine |
| `components/pool-view.tsx` | mounts one `PoolScene` and forwards props to its setters |
| `components/controls.tsx`, `gate.tsx` | the sliders and readout; the first-tap screen |
| `lib/sim.ts` | `Sim`: bowls, current, collisions, dragging. Emits `Strike`s. No rendering, no audio |
| `lib/audio.ts` | `Chimes`: one Web Audio voice per strike, plus the hall reverb |
| `lib/scene/pool.ts` | `PoolScene`: renderer, camera, controls, the rAF loop, pointer handling |
| `lib/scene/bowl.ts` | the lathe-turned bowl, its material, and its render-only bob, tip and spin |
| `lib/scene/waves.ts` | `Waves`: the water's surface, simulated on the GPU |
| `lib/scene/water.ts` | the basin meshes, the water shader, the caustics, and the frame's two passes |
| `scripts/measure-strikes.js` | measures the real installation's recording (see the README) |

## Architecture

**React holds the settings; three.js holds the frame.** `page.tsx` owns `count`, `current`, `volume`, `muted` and the `Chimes` instance, which it creates inside the gate's click handler because browsers only start audio from a gesture. `chimes === null` means "not started", and the scene doesn't step the simulation until it has one. `pool-view.tsx` creates a `PoolScene` on mount and pushes changes in through `setCount`, `setCurrent`, `setChimes` and `resetView`; strikes come back out through one `onStrike` callback, for the readout.

Everything per-frame is imperative three.js in `lib/scene/*`, outside React, so the React Compiler lint never sees the mutation. Keep it that way: new per-frame state belongs in a scene class, not in a ref in a component.

**One tick** (`PoolScene.tick`): step the simulation → sound and draw its strikes → update the bowl meshes → hand the bowls' waterline circles to the water and the wave simulation → render.

**Units.** `sim.ts` is 2D and in **centimetres**, on the water's surface. The scene is in **metres** with y up. Sim (x, y) maps to world (x / 100, 0, y / 100), and the water's surface is y = 0.

**The sound is fitted, not invented.** Every number in `audio.ts` comes from measuring the installation's own recording. The README's "Sound model" section lists what was measured beside what the code does. Re-measure with `scripts/measure-strikes.js` before retuning by ear.

## Invariants

These are the things that broke once and would break again.

- **Shadows must be updated in the second render pass.** A frame renders twice (`buildPool().render`): the scene without its water or bowls into a render target for refraction, then everything. three tests a shadow caster against the **view camera's** layers, not the light's, so updating shadows in the first pass — which has `BOWL_LAYER` disabled — silently leaves the bowls out of the shadow map altogether.
- **Bowls stay out of the refraction pass.** Once the waves bend that view, a bowl in it shows up as a ghost copy floating on the lining.
- **Caustics multiply `reflectedLight.directDiffuse`, never the lining's colour.** Riding on the sunlight, they vanish inside a bowl's shadow by themselves, with the shadow's own soft edge; masking them per bowl instead cuts a hard circle through the ripples. This also makes them about 4× weaker than the same gains applied to the albedo, which is what the numbers in `withCaustics` account for.
- **The water is cut out of the bowls** by their waterline circles (`uBowls`, at most `MAX_BOWLS` = the bowls slider's maximum). Raising `DRAFT` in `bowl.ts` far enough to sink a well's floor below y = 0 puts water back inside the bowls.
- **`waves.ts` steps at a fixed 60 Hz**, whatever the frame rate. A bowl's wake is its old waterline footprint minus its new one, so any jump in position reads as a huge shove: call `resetBowls()` whenever the bowl list is replaced.
- **Bowl interiors are shaded by vertex colours** indexed off the lathe profile's points, so editing `profile()` changes which points count as inside the well.
- **Dragging uses a capture-phase `pointerdown`**, so a grab beats OrbitControls' own listener on the same canvas. A pointer ray near the horizon meets the water plane almost infinitely far away, so `waterPoint` rejects grazing rays; without that, a drag sends a bowl's speed non-finite and on into the audio.

## Conventions

- The visual language is the installation's: cerulean lining, cream porcelain, a dark slate room. Keep new UI inside it, and keep the chrome out of the pool's way.
- Comments say why, in prose, and assume a reader who knows three.js and Web Audio. Match the surrounding density rather than narrating.
- Shaders live beside the meshes they belong to, as `/* glsl */`-tagged template literals so editors highlight them.
