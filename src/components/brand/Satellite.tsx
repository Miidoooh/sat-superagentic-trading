"use client";

import { useId } from "react";

export type SatMood = "watching" | "whale" | "pump" | "scanning";

interface Props {
  mood?: SatMood;
  size?: number;
  /** Draw the orbit ring around the satellite. */
  orbit?: boolean;
  /** Turn off idle motion (for static exports and tiny icons). */
  still?: boolean;
  className?: string;
}

/**
 * SAT, the satellite. Drawn in code so it is identical everywhere, sharp at
 * any size, and can react to live data: the eye widens for whales, smiles for
 * pumps and casts a beam while scanning.
 */
export default function Satellite({ mood = "watching", size = 160, orbit = true, still = false, className = "" }: Props) {
  const id = useId().replace(/:/g, "");
  const g = (name: string) => `${name}-${id}`;
  return (
    <svg
      className={`sat-bot mood-${mood} ${still ? "is-still" : ""} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label={`SAT the satellite, ${mood === "whale" ? "whale spotted" : mood}`}
    >
      <defs>
        <linearGradient id={g("body")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#C9C3F7" />
        </linearGradient>
        <linearGradient id={g("visor")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1A2142" />
          <stop offset="1" stopColor="#070A16" />
        </linearGradient>
        <radialGradient id={g("eye")} cx="0.42" cy="0.38" r="0.7">
          <stop offset="0" stopColor="#F4FFB0" />
          <stop offset="0.45" stopColor="#CCFF00" />
          <stop offset="1" stopColor="#8FCF00" />
        </radialGradient>
        <linearGradient id={g("beam")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#CCFF00" stopOpacity="0.85" />
          <stop offset="1" stopColor="#CCFF00" stopOpacity="0" />
        </linearGradient>
        <filter id={g("glow")} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g className="sat-float">
        {/* Back half of the orbit, behind the body. */}
        {orbit && (
          <path className="sat-orbit" d="M28 128 C 30 96, 170 96, 172 128" fill="none" stroke="#CCFF00" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
        )}

        {/* Scanning beam. */}
        <polygon className="sat-beam" points="118,100 200,70 200,130" fill={`url(#${g("beam")})`} />

        {/* Solar wings. */}
        <g className="sat-wing sat-wing-l">
          <rect x="62" y="96" width="14" height="6" rx="2" fill="#A9A3E0" />
          <g transform="rotate(-12 38 99)">
            <rect x="14" y="80" width="48" height="38" rx="6" fill="#CCFF00" />
            <path d="M30 80v38M46 80v38M14 99h48" stroke="#0B1020" strokeWidth="2.6" opacity="0.55" />
          </g>
        </g>
        <g className="sat-wing sat-wing-r">
          <rect x="124" y="96" width="14" height="6" rx="2" fill="#A9A3E0" />
          <g transform="rotate(12 162 99)">
            <rect x="138" y="80" width="48" height="38" rx="6" fill="#CCFF00" />
            <path d="M154 80v38M170 80v38M138 99h48" stroke="#0B1020" strokeWidth="2.6" opacity="0.55" />
          </g>
        </g>

        {/* Antenna. */}
        <line x1="100" y1="58" x2="100" y2="34" stroke="#C9C3F7" strokeWidth="4" strokeLinecap="round" />
        <circle className="sat-antenna" cx="100" cy="30" r="7" fill="#CCFF00" filter={`url(#${g("glow")})`} />

        {/* Body. */}
        <rect x="66" y="54" width="68" height="92" rx="34" fill={`url(#${g("body")})`} />
        <rect x="66" y="54" width="68" height="92" rx="34" fill="none" stroke="#FFFFFF" strokeOpacity="0.6" strokeWidth="1.5" />

        {/* Visor and eye. */}
        <rect x="74" y="72" width="52" height="44" rx="20" fill={`url(#${g("visor")})`} />
        <g className="sat-eye" filter={`url(#${g("glow")})`}>
          {mood === "pump" ? (
            <path d="M86 98 Q100 82 114 98" fill="none" stroke="#CCFF00" strokeWidth="7" strokeLinecap="round" />
          ) : (
            <>
              <circle className="sat-iris" cx="100" cy="94" r={mood === "whale" ? 15 : 12} fill={`url(#${g("eye")})`} />
              <circle cx="100" cy="94" r={mood === "whale" ? 6 : 5} fill="#0B1020" />
              <circle cx="104" cy="90" r="2.4" fill="#FFFFFF" opacity="0.9" />
            </>
          )}
        </g>

        {/* Belly light. */}
        <rect x="92" y="126" width="16" height="5" rx="2.5" fill="#CCFF00" opacity="0.8" className="sat-belly" />

        {/* Front half of the orbit, over the body. */}
        {orbit && (
          <path className="sat-orbit" d="M28 128 C 30 160, 170 160, 172 128" fill="none" stroke="#CCFF00" strokeWidth="5" strokeLinecap="round" />
        )}

        {/* Mood extras. */}
        {mood === "whale" && (
          <g className="sat-spark">
            <path d="M150 40 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z" fill="#CCFF00" />
            <path d="M44 46 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5z" fill="#FFFFFF" opacity="0.8" />
          </g>
        )}
        {mood === "pump" && (
          <g className="sat-confetti">
            <rect x="40" y="34" width="8" height="8" rx="2" fill="#CCFF00" transform="rotate(20 44 38)" />
            <rect x="152" y="30" width="7" height="7" rx="2" fill="#00D40A" transform="rotate(-15 155 33)" />
            <rect x="166" y="64" width="6" height="6" rx="1.5" fill="#CCFF00" />
            <rect x="28" y="70" width="6" height="6" rx="1.5" fill="#FFFFFF" opacity="0.8" />
            <circle cx="132" cy="22" r="3.5" fill="#FFFFFF" opacity="0.85" />
            <circle cx="64" cy="20" r="3" fill="#00D40A" />
          </g>
        )}
      </g>
    </svg>
  );
}
