"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { Controls } from "@/components/controls";
import { DropZone, type Progress } from "@/components/drop-zone";
import type { Cuts, Opacity } from "@/components/video-cube";
import { extractFrames, releaseVolume, type Volume } from "@/lib/extract-frames";

const VideoCube = dynamic(() => import("@/components/video-cube"), { ssr: false });

const UNCUT: Cuts = { x: [0, 1], y: [0, 1], t: [0, 1] };
const OPACITY: Opacity = { haze: 0.85, frame: 0.9 };
const IDLE_AFTER_MS = 2000;

export default function Home() {
  const [volume, setVolume] = useState<Volume | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [cuts, setCuts] = useState<Cuts>(UNCUT);
  const [opacity, setOpacity] = useState<Opacity>(OPACITY);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [saveKey, setSaveKey] = useState(0);
  const [idle, setIdle] = useState(false);

  // a newer file cancels the extraction still in flight
  const extraction = useRef<AbortController | null>(null);

  const load = async (file: File) => {
    extraction.current?.abort();
    const controller = new AbortController();
    extraction.current = controller;
    setVolume(null);
    setFailed(false);
    setProgress({ done: 0, total: 0 });
    try {
      const next = await extractFrames(file, (done, total) => setProgress({ done, total }), controller.signal);
      setCuts(UNCUT);
      setActive(0);
      setPlaying(true);
      setVolume(next);
    } catch {
      if (controller.signal.aborted) return;
      setFailed(true);
    }
    setProgress(null);
  };

  // stop the previous video and free its file when it is replaced or cleared
  useEffect(() => {
    if (!volume) return;
    return () => releaseVolume(volume);
  }, [volume]);

  const reset = useCallback(() => {
    setCuts(UNCUT);
    setOpacity(OPACITY);
    setResetKey((k) => k + 1);
  }, []);

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
    <main
      className="relative h-dvh w-full select-none"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // moving onto a child also fires dragleave; only leaving the page counts
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file?.type.startsWith("video/")) load(file);
        // say so on the empty screen, but never throw away a loaded cube over a stray drop
        else if (file && !volume) setFailed(true);
      }}
    >
      {volume ? (
        <div className="absolute inset-0">
          <VideoCube
            volume={volume}
            cuts={cuts}
            active={active}
            playing={playing}
            opacity={opacity}
            onActiveChange={setActive}
            onPlayingChange={setPlaying}
            resetKey={resetKey}
            saveKey={saveKey}
          />
        </div>
      ) : (
        <DropZone progress={progress} failed={failed} dragging={dragging} onFile={load} />
      )}

      <header className="pointer-events-none absolute top-0 left-0 p-6 sm:p-10">
        <h1 className="text-lg tracking-wide">xy + t</h1>
        <p className="mt-1 text-xs text-muted-foreground">a video, held as an object</p>
      </header>

      {volume && (
        <footer
          className={`absolute inset-x-0 bottom-0 p-6 transition-opacity duration-1000 sm:p-10 ${
            idle ? "opacity-15" : "opacity-100"
          }`}
        >
          <Controls
            cuts={cuts}
            onCutsChange={setCuts}
            opacity={opacity}
            onOpacityChange={setOpacity}
            active={active}
            frames={volume.depth}
            playing={playing}
            onPlayingChange={setPlaying}
            onReset={reset}
            onSave={() => setSaveKey((k) => k + 1)}
            onNew={() => {
              setPlaying(false);
              setVolume(null);
            }}
          />
        </footer>
      )}
    </main>
  );
}
