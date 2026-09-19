# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

xy + t: a browser-only app that turns a dropped video into a 3D volume (x, y, time) you can orbit, cut and play through. It's one self-contained project inside the `train-of-thoughts` mono repo. Each project there lives in its own `YYMMDD-name` folder with its own tooling, and a row for it goes in the root `README.md` table.

Stack: Next.js 16 (App Router, Turbopack), React 19 with the React Compiler lint rules, Bun, Tailwind v4, shadcn/ui on **Base UI** (not Radix; `cn` comes from the `cn` package), three.js with `@react-three/fiber` and `@react-three/drei`.

## Commands

```sh
bun install
bun run dev        # http://localhost:3000
bun run build
bun run lint       # eslint, including react-hooks/immutability from the React Compiler
bunx tsc --noEmit  # typecheck; there is no test suite
```

For a test clip, use `ffmpeg -f lavfi -i testsrc2=duration=6:size=1920x1080:rate=30 -pix_fmt yuv420p hd.mp4`. When driving the app with Chrome automation, extraction stalls while the tab is `document.visibilityState === "hidden"`, because Chrome pauses media loading in background tabs.

## Architecture

Data flow: `app/page.tsx` owns all state (volume, cuts, `active`, `playing`). It passes that state down to `components/drop-zone.tsx` (empty and loading screens), `components/video-cube.tsx` (the 3D view, loaded with `ssr: false`) and `components/controls.tsx`.

**Two resolutions, on purpose.** `lib/extract-frames.ts` seeks through the video and stacks up to 256 frames, 576px on the long edge, into one RGBA `Data3DTexture`. That is the translucent haze and the slit-scan cut faces. A full-resolution volume would be gigabytes. The same `<video>` element is kept alive in `Volume.video`, and the **active frame** is sampled from it at native resolution as a 2D texture. `releaseVolume` pauses the video and revokes its object URL, and the page calls it when a volume is replaced.

**One raymarching shader draws everything** (`fragmentShader` in `video-cube.tsx`):
- It works in box space `p ∈ [0,1]³` with x right, y up and z toward the viewer. Time runs into the screen, so `t = 1 − p.z`.
- The cut sliders are in (x, y, t). They become `uMin` and `uMax` with the t axis flipped: `uMin.z = 1 − t1`, `uMax.z = 1 − t0`.
- The rays march front to back through the cut box, and haze opacity is normalised per unit of clip depth, so it doesn't depend on the view angle.
- A ray stops at the plane of the active frame and samples `uFrame` there. That plane is what hides the frames behind it.
- The output is premultiplied alpha in raw sRGB. The canvas is `flat` with no colour conversion. `srgb()` parses the theme's `--background` for the shader, so that variable must stay a plain hex colour.

**Time mapping.** `active ∈ [0,1]` spans the first to the last sampled frame. The video time is `active * volume.span`, and the haze position is `(active·(depth−1)+0.5)/depth`.

**Playback lives in `useFrame`.**
- The `session` ref starts the video from `active` and stops it at the end of the `t` range (plays once).
- While paused, the video seeks to follow `active`, one seek at a time, which is how scrubbing works.
- The video texture re-uploads only while the video is playing or after a `seeked` event.
- Hovering the cube pauses playback. An invisible plane over the active frame is the drag handle: it projects the time axis to screen space and turns off OrbitControls while you drag.
- The canvas uses `frameloop="demand"`, so nothing is drawn while the cube is still. A change to props or state invalidates it through an effect in `VolumeMesh`. `useFrame` keeps invalidating while the video plays or the fade settles, and a `seeked` event invalidates too. Anything new that changes the picture outside React state must call `invalidate()`.

## Gotchas

- **React Compiler lint** rejects mutating props or memoised values inside `useFrame` or event handlers. Reach mutable three.js and DOM objects through refs, the way `playback.current` and `mesh.current.material.uniforms` do.
- A plain `THREE.Texture` sizes its storage from the image's `width` and `height` attributes, which are 0 on a `<video>`. `extract-frames.ts` sets them to `videoWidth` and `videoHeight`. Without that, the active frame renders black.
- Dark mode uses the `prefers-color-scheme` media query (`@custom-variant dark` in `app/globals.css`), not a `.dark` class. Theme colours are CSS variables, which `video-cube.tsx` reads at runtime.
- The visual language is Zen-minimal: washi paper and sumi ink tokens, Shippori Mincho with Geist Mono, hairline UI, and no accent colour. Keep new UI inside it.
