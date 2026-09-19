"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Controls, type LastStrike } from "@/components/controls";
import { Gate } from "@/components/gate";
import { Chimes } from "@/lib/audio";
import type { Strike } from "@/lib/sim";

const PoolView = dynamic(() => import("@/components/pool-view"), { ssr: false });

const IDLE_AFTER_MS = 2500;
/** A hairline-underlined link that stays clickable inside the header, which lets clicks through. */
const LINK =
  "pointer-events-auto underline decoration-foreground/30 underline-offset-2 transition-colors hover:text-foreground";

export default function Home() {
  const [count, setCount] = useState(24);
  const [current, setCurrent] = useState(0.5);
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [chimes, setChimes] = useState<Chimes | null>(null);
  const [lastStrike, setLastStrike] = useState<LastStrike | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [idle, setIdle] = useState(false);

  useEffect(() => chimes?.setLevel(muted ? 0 : volume), [chimes, muted, volume]);
  useEffect(() => () => chimes?.close(), [chimes]);

  const onStrike = ({ a, b }: Strike) => {
    const [big, small] = a.d >= b.d ? [a, b] : [b, a];
    setLastStrike({ sizes: [big.d, small.d], freqs: [Math.round(big.voice.freq), Math.round(small.voice.freq)] });
  };

  // let the controls recede when the hand is still
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), IDLE_AFTER_MS);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_AFTER_MS);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  return (
    <main className="relative h-dvh w-full select-none">
      <PoolView count={count} current={current} chimes={chimes} resetKey={resetKey} onStrike={onStrike} />

      <header className="pointer-events-none absolute top-0 left-0 p-6 sm:p-10">
        <h1 className="font-serif text-4xl leading-none italic">clinamen</h1>
        <p className="mt-2 text-xs text-muted-foreground">porcelain bowls on a slow current, ringing when they meet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          created by{" "}
          <a href="https://www.yixtian.com/" target="_blank" rel="noreferrer" className={LINK}>
            Yixin Tian
          </a>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          inspired by{" "}
          <a href="https://www.youtube.com/shorts/_TaMMeav8I0" target="_blank" rel="noreferrer" className={LINK}>
            Céleste Boursier-Mougenot&rsquo;s installation
          </a>
        </p>
      </header>

      {chimes ? (
        <footer
          className={`absolute bottom-0 left-0 p-4 transition-opacity duration-1000 sm:p-10 ${idle ? "opacity-20" : "opacity-100"}`}
        >
          <div className="panel max-w-3xl rounded-sm px-5 py-4">
            <Controls
              count={count}
              onCountChange={setCount}
              current={current}
              onCurrentChange={setCurrent}
              volume={volume}
              onVolumeChange={setVolume}
              muted={muted}
              onMutedChange={setMuted}
              lastStrike={lastStrike}
              onResetView={() => setResetKey((k) => k + 1)}
            />
          </div>
        </footer>
      ) : (
        <Gate
          onStart={() => {
            const c = new Chimes();
            c.resume();
            setChimes(c);
          }}
        />
      )}
    </main>
  );
}
