"use client";

/** Browsers only start audio from a gesture, so the first tap sets everything going. */
export function Gate({ onStart }: { onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      className="absolute inset-0 z-10 flex cursor-pointer items-center justify-center bg-[rgba(8,42,66,0.28)] outline-none"
    >
      <span className="panel rounded-sm px-9 py-7 text-center">
        <span className="block font-serif text-3xl italic">Tap to set the water moving</span>
        <span className="mt-2 block text-[12.5px] tracking-wide text-muted-foreground">
          Sound on. The bowls will begin to drift and chime.
        </span>
      </span>
    </button>
  );
}
