# xy + t

A video, held as an object. Drop in a clip and its frames stack up through time into a cube you can rotate, zoom and pan. Every frame is a faint, translucent layer. The one active frame is bright and solid, and it travels through the haze once as the video plays.

## Run

```sh
bun install
bun run dev
```

Open http://localhost:3000 and drop in a video. Everything runs in the browser, and nothing is uploaded.

## Controls

| | |
|---|---|
| drag · scroll · right-drag | rotate · zoom · pan |
| `x` `y` `t` sliders | cut the cube along an axis. Cut faces show slit-scans. |
| `space` | play the clip once, from the start of the `t` range / pause |
| `r` | reset the cuts and the camera |
| save image | download the current view as a 4K PNG, with the clip's stats and the project name |

## How it works

- `lib/extract-frames.ts` seeks through the video and samples up to 256 evenly spaced frames at 320px wide. It stores them in one RGBA volume.
- `components/video-cube.tsx` uploads that volume as a WebGL2 3D texture and raymarches it inside a box:
  - Each sample adds a little translucent colour. Pixels that differ more from the page colour carry more ink.
  - The ray stops at the active frame's plane and draws that frame at full brightness.
  - The x/y/t cuts only move the box's bounds. Whatever the ray enters through becomes a cross-section, either a frame or a slit-scan.
