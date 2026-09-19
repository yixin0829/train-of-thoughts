"use client";

import { useRef } from "react";

const STACK_FRAMES = 24;

/** Frame outlines piling up into depth as they load; the newest sits in front, a shade deeper. */
function FrameStack({ fraction }: { fraction: number }) {
  const count = Math.max(1, Math.ceil(fraction * STACK_FRAMES));
  return (
    <svg viewBox="0 0 280 200" aria-hidden className="h-50 w-70 text-foreground">
      {Array.from({ length: count }, (_, i) => {
        const depth = count - 1 - i;
        const newest = depth === 0 && fraction < 1;
        return (
          <rect
            key={i}
            x={30 + depth * 3.6}
            y={90 - depth * 2.6}
            width={160}
            height={90}
            fill="currentColor"
            fillOpacity={newest ? 0 : 0.035}
            stroke="currentColor"
            strokeOpacity={newest ? 0.65 : 0.1 + 0.3 * (1 - depth / STACK_FRAMES)}
          />
        );
      })}
    </svg>
  );
}

export type Progress = { done: number; total: number };

type DropZoneProps = {
  progress: Progress | null;
  failed: boolean;
  dragging: boolean;
  onFile: (file: File) => void;
};

export function DropZone({ progress, failed, dragging, onFile }: DropZoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const loading = progress !== null;

  let caption = "drop a video";
  if (loading && progress.total > 0) {
    const done = String(progress.done).padStart(String(progress.total).length, "0");
    caption = `frame ${done} of ${progress.total}`;
  } else if (loading) caption = "gathering frames";
  else if (failed) caption = "this video could not be read · try another";

  return (
    <>
      <button
        type="button"
        disabled={loading}
        onClick={() => input.current?.click()}
        className="group absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-8 outline-none focus-visible:[&_.hairline-pill]:ring-2 focus-visible:[&_.hairline-pill]:ring-ring/50 disabled:cursor-default"
      >
        {loading ? (
          <>
            <FrameStack fraction={progress.total > 0 ? progress.done / progress.total : 0} />
            <span className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground">{caption}</span>
          </>
        ) : (
          <span
            className={`hairline-pill rounded-full border border-foreground/50 px-7 py-3.5 font-mono text-[11px] tracking-[0.2em] transition-[scale,border-color] duration-500 ease-out group-hover:scale-[1.03] group-hover:border-foreground/80 ${
              dragging ? "scale-[1.06] border-foreground/80" : ""
            }`}
          >
            {caption}
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </>
  );
}
