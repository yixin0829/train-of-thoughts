# clinamen

A pool of blue water, a few dozen white porcelain bowls, and a slow current. The bowls drift, meet, and ring. Nothing is composed: the current decides which bowls touch, and the bowls decide what note that makes. Open the page, tap once, walk around the pool, and let it play as long as you like. It never repeats.

Inspired by [clinamen](https://www.youtube.com/shorts/_TaMMeav8I0), an installation by Céleste Boursier-Mougenot, as shown at the Park Avenue Armory.

## Vision

- **The pool is the instrument.** No sequencer, no loop, no score. Every sound comes from two bowls colliding in a physics simulation, so the music is a side effect of the water.
- **Size is pitch.** Large bowls ring low and long, small bowls higher and shorter, as porcelain does. The model is fitted to the installation's own recording (see [Sound model](#sound-model)).
- **It should look like the room.** Cerulean lining under clear water, cream porcelain with a bright lip and a shaded well, bowl shadows on the pool floor, a dark slate room around it.
- **Touch is allowed.** Orbit around the pool, or drag a bowl into another to hear a chosen pair. Let go and the current takes over again.

## Run

```sh
bun install
bun run dev        # http://localhost:3000
bun run build
bun run lint
bunx tsc --noEmit
```

Sound starts on the first tap, as browsers require.

## Controls

| | |
|---|---|
| tap | start the water and the sound |
| drag the water · scroll · right-drag | orbit · zoom · pan |
| drag a bowl | push it into another bowl; it follows the hand with its weight, so big bowls lag and coast |
| `bowls` | how many bowls float in the pool (6 to 48) |
| `current` | strength of the vortex and its wandering eddies |
| `volume` · mute (`m`) | output level |
| reset view (`r`) | back to the start view |
| last strike | which two bowl sizes just met, and their fundamentals in Hz |

## How it works

Next.js 16 with React 19, Tailwind v4 and shadcn/ui on Base UI, and plain three.js for the scene.

- **`lib/sim.ts`, the pool.** A 3 m circle simulated in centimetres, in 2D on the water's surface. Each bowl has a diameter from a weighted list and a mass proportional to its area. The current is a vortex with strong shear (mid-radius water moves fastest) plus a wandering sine field, and bowls relax toward it more slowly the heavier they are, so rings pass one another and collide. Collisions separate by inverse mass with restitution 0.45. A dragged bowl is pulled toward the hand by a damped spring acting on its mass, so a 36 cm bowl takes about three times longer than a 12 cm one to catch up. When the closing speed is high enough, `step()` returns a strike with an intensity from that speed, and a short per-pair cooldown stops resting contact from chattering.
- **`lib/audio.ts`, the sound.** Each strike becomes a Web Audio voice: four shell modes with their own decays, a slowly beating doublet on the fundamental, a short band-passed "tok" of contact, then a stereo pan from where the strike sits on screen and a synthetic hall reverb. A bowl that is struck again replaces its own ringing voice, and at most 48 voices sound at once.
- **`lib/scene/`, the 3D view.** `pool.ts` owns the renderer, camera, OrbitControls and the loop, which steps the simulation, plays its strikes, and draws. `bowl.ts` turns a porcelain profile on a lathe, shades the well with vertex colours, and adds a render-only bob, tip and spin when a bowl is struck. `waves.ts` simulates the water's surface on the GPU: a 256² height field stepping the wave equation 60 times a second, so strikes drop rings that spread, cross and bounce off the pool wall, and moving bowls push water aside and leave wakes. `water.ts` builds the basin and the water shader, which takes its normals from that height field, refracts the pool below (drawn first into a render target) through the waves, mirrors the hall at glancing angles, and leaves the water out of the bowls. The lining's caustics come from the same surface: convex water focuses the sunlight into bright lines. They ride on the sunlight itself, so they fade out inside a bowl's shadow rather than being cut around it, and the shadows stay dark against the blue.
- **`components/pool-view.tsx`** mounts the scene and passes settings in; everything per-frame stays outside React.

## Sound model

The prototype's chime (fundamentals 0.7–2.4 kHz, five bright partials, a 3 s room) sounded thin next to the installation. So the numbers now come from its recording. YouTube keeps the audio inside the page, so the measuring runs there: open the video, paste [`scripts/measure-strikes.js`](scripts/measure-strikes.js) into the console, and it records the 39 s clip once and prints the figures below. Speech is filtered out by keeping only spectral peaks that hold within 0.4 % for at least 0.6 s. A struck bowl does that, a voice glides.

| measured in the recording | value | in `lib/audio.ts` |
|---|---|---|
| fundamentals | ~170 Hz – 1 kHz, most 300–700 Hz | `1000 · (12 / d)^1.4` Hz: 1 kHz at 12 cm, ~215 Hz at 36 cm |
| second mode | ×2.74 (median of 38 pairs, e.g. 441 → 1226 Hz, 608 → 1668 Hz) | ×2.75 |
| third mode | ×5.17 (441 → 2282 Hz, 509 → 2638 Hz) | ×5.17, plus an extrapolated ×8.4 |
| second mode's level at the strike | about equal to the fundamental | amplitude 1 |
| decay, partials under 700 Hz | median −3.8 dB/s | fundamental T60 6–11 s by size |
| decay, partials over 1.1 kHz | median −10.8 dB/s | upper modes die 5–25× faster than the fundamental |
| spectrum (half-octave, speech-free tail) | flat 150 Hz – 1.2 kHz, −7 dB at 2.4 kHz, −15 to −18 dB at 3.4–4.8 kHz | within ~4 dB from 200 Hz to 2.4 kHz |

That is where "lower and more hollow" comes from. The note is an octave or more lower than before, and after a bright first instant the ring is almost pure fundamental. The second mode starts as loud as the fundamental but is gone within a second or two.

The echo is a synthetic impulse response for a very large hard room: 30 ms pre-delay, a spray of early reflections in the first 120 ms, then a tail whose lows outlast its highs (T60 about 5 s below 400 Hz, 3.8 s in the middle, 1.6 s above 2.5 kHz), mixed wetter than dry.

To check a change to the synth, render it with an `OfflineAudioContext` in the same page and run the same measurements on the result. That is how the parameters above were tuned.

## Not yet

- Bowl-on-wall contact is silent.
- The recording is a phone clip with a narrator over it, so the room's decay is designed to match what's audible rather than measured.
