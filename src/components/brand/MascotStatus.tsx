"use client";

import Satellite from "./Satellite";
import { useMood } from "./mood";

const LABEL = { watching: "SAT is watching the chain", whale: "Whale spotted!", pump: "Something is pumping", scanning: "Scanning…" } as const;

/** SAT in the top bar: a live status light that reacts to what happens. */
export default function MascotStatus() {
  const mood = useMood();
  return (
    <span className="mascot-status" title={LABEL[mood]} aria-live="polite" aria-label={LABEL[mood]}>
      <Satellite mood={mood} size={34} orbit={false} />
    </span>
  );
}
