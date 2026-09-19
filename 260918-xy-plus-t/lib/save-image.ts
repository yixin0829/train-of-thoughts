import type { Volume } from "@/lib/extract-frames";

/** Smallest long edge of the saved image, in pixels. */
export const SAVE_LONG_EDGE = 3840;

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Lay a rendered view of the cube on paper, add the clip's stats in the bottom-left corner and
 * the project name in the top-left, like a photo with an activity overlay, and download it.
 * `render` must still hold the frame just drawn, so call this in the same task as the render.
 * `active` is null when the active frame is cut away, which leaves its stat out.
 */
export function saveImage(render: HTMLCanvasElement, volume: Volume, active: number | null) {
  const { width, height } = render;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = cssVar("--background");
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(render, 0, 0);

  const serif = cssVar("--font-shippori");
  const mono = cssVar("--font-geist-mono");
  const ink = cssVar("--foreground");
  const muted = cssVar("--muted-foreground");
  // everything is measured in hundredths of the short edge, so the overlay scales with the image
  const u = Math.min(width, height) / 100;
  const margin = 6 * u;
  const bottom = height - margin;

  const frame = active === null ? null : Math.round(active * (volume.depth - 1)) + 1;
  const pad = (n: number) => String(n).padStart(String(volume.depth).length, "0");
  const stats = [
    ["duration", `${volume.video.duration.toFixed(1)} s`],
    ["frames", String(volume.depth)],
    ["source", `${volume.video.videoWidth} × ${volume.video.videoHeight}`],
  ];
  if (frame !== null) stats.push(["frame", `${pad(frame)} / ${volume.depth}`]);

  ctx.textBaseline = "alphabetic";
  let x = margin;
  for (const [label, value] of stats) {
    ctx.textAlign = "left";
    ctx.letterSpacing = `${0.3 * u}px`;
    ctx.font = `${1.6 * u}px ${mono}`;
    ctx.fillStyle = muted;
    ctx.fillText(label, x, bottom - 5.2 * u);
    const labelWidth = ctx.measureText(label).width;
    ctx.letterSpacing = "0px";
    ctx.font = `${3.6 * u}px ${mono}`;
    ctx.fillStyle = ink;
    ctx.fillText(value, x, bottom);
    x += Math.max(labelWidth, ctx.measureText(value).width) + 5 * u;
  }

  // the name sits where the app's own header does
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `${4 * u}px ${serif}`;
  ctx.fillStyle = ink;
  ctx.fillText("xy + t", margin, margin);
  ctx.font = `${1.6 * u}px ${serif}`;
  ctx.fillStyle = muted;
  ctx.fillText("a video, held as an object", margin, margin + 5.4 * u);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = frame === null ? "xy-plus-t.png" : `xy-plus-t-frame-${pad(frame)}.png`;
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
