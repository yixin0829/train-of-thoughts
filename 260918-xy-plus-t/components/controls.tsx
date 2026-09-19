"use client";

import { Pause, Play, Plus, RotateCcw } from "lucide-react";
import { useEffect, useEffectEvent } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { Cuts, Opacity, Range } from "@/components/video-cube";

type ControlsProps = {
  cuts: Cuts;
  onCutsChange: (cuts: Cuts) => void;
  opacity: Opacity;
  onOpacityChange: (opacity: Opacity) => void;
  active: number;
  frames: number;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onReset: () => void;
  onNew: () => void;
};

const AXES = ["x", "y", "t"] as const;
const LAYERS = ["haze", "frame"] as const;

export function Controls({
  cuts,
  onCutsChange,
  opacity,
  onOpacityChange,
  active,
  frames,
  playing,
  onPlayingChange,
  onReset,
  onNew,
}: ControlsProps) {
  // Subscribed once: re-subscribing on every playback frame could drop a key press whose
  // dispatch re-renders the page before this listener's turn comes.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    // a focused button already answers space and enter on its own
    if (e.target instanceof HTMLElement && e.target.closest("button, input")) return;
    if (e.key === " ") {
      e.preventDefault();
      onPlayingChange(!playing);
    } else if (e.key === "r") {
      onReset();
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const frame = Math.round(active * (frames - 1)) + 1;
  const pad = (n: number) => String(n).padStart(String(frames).length, "0");

  return (
    <div className="flex flex-wrap items-end gap-x-14 gap-y-6 font-mono text-[11px] text-muted-foreground">
      <div className="grid grid-cols-[1ch_8rem] items-center gap-x-4">
        {AXES.map((axis) => (
          <label key={axis} className="contents">
            <span>{axis}</span>
            <Slider
              aria-label={`cut ${axis}`}
              min={0}
              max={1}
              step={0.001}
              minStepsBetweenValues={10}
              value={cuts[axis]}
              onValueChange={(value) => onCutsChange({ ...cuts, [axis]: value as Range })}
            />
          </label>
        ))}
      </div>

      <div className="grid grid-cols-[5ch_8rem] items-center gap-x-4">
        {LAYERS.map((layer) => (
          <label key={layer} className="contents">
            <span>{layer}</span>
            <Slider
              aria-label={`${layer} opacity`}
              min={0}
              max={1}
              step={0.01}
              value={opacity[layer]}
              onValueChange={(value) => onOpacityChange({ ...opacity, [layer]: value as number })}
            />
          </label>
        ))}
      </div>

      <div className="flex flex-1 justify-end">
        <span className="whitespace-nowrap tabular-nums">
          {pad(frame)} / {frames}
        </span>
      </div>

      <div className="-mr-2 flex gap-1">
        <IconButton label={playing ? "pause (space)" : "play (space)"} onClick={() => onPlayingChange(!playing)}>
          {playing ? <Pause /> : <Play />}
        </IconButton>
        <IconButton label="reset (r)" onClick={onReset}>
          <RotateCcw />
        </IconButton>
        <IconButton label="another video" onClick={onNew}>
          <Plus />
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-full text-foreground/70 hover:bg-transparent hover:text-foreground [&_svg]:stroke-[1.25]"
    >
      {children}
    </Button>
  );
}
