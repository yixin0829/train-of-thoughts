"use client";

import { useEffect, useEffectEvent, useRef } from "react";

import type { Chimes } from "@/lib/audio";
import { PoolScene } from "@/lib/scene/pool";
import type { Strike } from "@/lib/sim";

type PoolViewProps = {
  count: number;
  current: number;
  chimes: Chimes | null;
  resetKey: number;
  onStrike: (strike: Strike) => void;
};

/** Mounts the three.js pool and passes settings into it; the scene runs its own loop. */
export default function PoolView({ count, current, chimes, resetKey, onStrike }: PoolViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const pool = useRef<PoolScene | null>(null);
  const strike = useEffectEvent(onStrike);

  useEffect(() => {
    const scene = new PoolScene(host.current!, (s) => strike(s));
    pool.current = scene;
    return () => {
      scene.dispose();
      pool.current = null;
    };
  }, []);

  useEffect(() => pool.current?.setCount(count), [count]);
  useEffect(() => pool.current?.setCurrent(current), [current]);
  useEffect(() => pool.current?.setChimes(chimes), [chimes]);
  useEffect(() => {
    if (resetKey) pool.current?.resetView();
  }, [resetKey]);

  return <div ref={host} className="absolute inset-0" aria-label="Porcelain bowls drifting on a pool of blue water" role="img" />;
}
