export type Volume = {
  /** Low-resolution RGBA frames stacked through time, for the translucent haze. */
  data: Uint8Array;
  width: number;
  height: number;
  depth: number;
  /** The source video, kept at its native resolution for the active frame. */
  video: HTMLVideoElement;
  /** Seconds from the first sampled frame to the last. */
  span: number;
};

/** Long edge of each sampled frame, so a clip costs the same memory in either orientation (16:9 → 576×324, ~190 MB). */
const LONG_EDGE = 576;
const MAX_FRAMES = 256;
const SAMPLE_FPS = 30;

function once(target: EventTarget, type: string) {
  return new Promise<void>((resolve, reject) => {
    target.addEventListener(type, () => resolve(), { once: true });
    target.addEventListener("error", () => reject(new Error(`video ${type} failed`)), { once: true });
  });
}

/** Sample evenly spaced frames of a video file into one RGBA volume (x, y, t). Aborting stops between frames. */
export async function extractFrames(
  file: File,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Volume> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  try {
    await once(video, "loadeddata");
    // three sizes a texture from these attributes, which a video leaves at 0
    video.width = video.videoWidth;
    video.height = video.videoHeight;

    const scale = LONG_EDGE / Math.max(video.videoWidth, video.videoHeight);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    const depth = Math.max(2, Math.min(MAX_FRAMES, Math.floor(video.duration * SAMPLE_FPS)));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const frameSize = width * height * 4;
    const data = new Uint8Array(frameSize * depth);
    // stay just shy of the end: seeking to `duration` exactly often yields no frame
    const span = Math.max(0, video.duration - 0.05);

    for (let i = 0; i < depth; i++) {
      video.currentTime = (span * i) / (depth - 1);
      await once(video, "seeked");
      signal.throwIfAborted();
      ctx.drawImage(video, 0, 0, width, height);
      data.set(ctx.getImageData(0, 0, width, height).data, i * frameSize);
      onProgress(i + 1, depth);
    }

    return { data, width, height, depth, video, span };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Stop the source video and let go of its file. */
export function releaseVolume(volume: Volume) {
  volume.video.pause();
  URL.revokeObjectURL(volume.video.src);
}
