"use client";

import { RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useEffectEvent } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

export type LastStrike = { sizes: [number, number]; freqs: [number, number] };

type ControlsProps = {
  count: number;
  onCountChange: (count: number) => void;
  current: number;
  onCurrentChange: (current: number) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  lastStrike: LastStrike | null;
  onResetView: () => void;
};

export function Controls({
  count,
  onCountChange,
  current,
  onCurrentChange,
  volume,
  onVolumeChange,
  muted,
  onMutedChange,
  lastStrike,
  onResetView,
}: ControlsProps) {
  // subscribed once, reading the latest props through the effect event
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest("button, input")) return;
    if (e.key === "m") onMutedChange(!muted);
    else if (e.key === "r") onResetView();
  });
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-wrap items-end gap-x-10 gap-y-5 text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
      <div className="grid grid-cols-[auto_8rem_3ch] items-center gap-x-4 gap-y-3">
        <Row label="bowls" value={String(count)}>
          <Slider aria-label="bowls" min={6} max={48} step={1} value={count} onValueChange={(v) => onCountChange(v as number)} />
        </Row>
        <Row label="current" value={`${Math.round(current * 100)}`}>
          <Slider aria-label="current" min={0} max={1} step={0.01} value={current} onValueChange={(v) => onCurrentChange(v as number)} />
        </Row>
        <Row label="volume" value={`${Math.round(volume * 100)}`}>
          <Slider aria-label="volume" min={0} max={1} step={0.01} value={volume} onValueChange={(v) => onVolumeChange(v as number)} />
        </Row>
      </div>

      <div className="min-w-44 flex-1 normal-case tracking-normal" aria-live="polite">
        <div className="mb-1 text-[10.5px] tracking-[0.14em] uppercase">last strike</div>
        <div className="font-serif text-xl leading-tight text-foreground tabular-nums">
          {lastStrike ? `Ø ${lastStrike.sizes[0]} + ${lastStrike.sizes[1]} cm` : "—"}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {lastStrike ? `${lastStrike.freqs[0]} & ${lastStrike.freqs[1]} Hz` : " "}
        </div>
      </div>

      <div className="-mr-2 flex gap-1">
        <IconButton label={muted ? "unmute (m)" : "mute (m)"} pressed={muted} onClick={() => onMutedChange(!muted)}>
          {muted ? <VolumeX /> : <Volume2 />}
        </IconButton>
        <IconButton label="reset view (r)" onClick={onResetView}>
          <RotateCcw />
        </IconButton>
      </div>
    </div>
  );
}

function Row({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <label className="contents">
      <span>{label}</span>
      {children}
      <span className="text-right text-foreground tabular-nums">{value}</span>
    </label>
  );
}

function IconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className="rounded-full text-foreground/75 hover:bg-transparent hover:text-foreground [&_svg]:stroke-[1.25]"
    >
      {children}
    </Button>
  );
}
