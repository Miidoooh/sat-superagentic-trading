/**
 * A static SVG string of SAT the satellite, for places React components cannot
 * go: favicons, Apple touch icons and Open Graph images rendered on the server.
 * Same shapes as components/brand/Satellite, without animation or filters.
 */
export function satelliteSvg({ mood = "watching", orbit = true }: { mood?: "watching" | "whale" | "pump"; orbit?: boolean } = {}): string {
  const eye =
    mood === "pump"
      ? `<path d="M86 98 Q100 82 114 98" fill="none" stroke="#CCFF00" stroke-width="7" stroke-linecap="round"/>`
      : `<circle cx="100" cy="94" r="${mood === "whale" ? 19 : 16}" fill="#CCFF00" opacity="0.25"/>
         <circle cx="100" cy="94" r="${mood === "whale" ? 15 : 12}" fill="#CCFF00"/>
         <circle cx="100" cy="94" r="${mood === "whale" ? 6 : 5}" fill="#0B1020"/>
         <circle cx="104" cy="90" r="2.4" fill="#FFFFFF" opacity="0.9"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C9C3F7"/></linearGradient>
    <linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A2142"/><stop offset="1" stop-color="#070A16"/></linearGradient>
  </defs>
  ${orbit ? `<path d="M28 128 C 30 96, 170 96, 172 128" fill="none" stroke="#CCFF00" stroke-width="5" stroke-linecap="round" opacity="0.55"/>` : ""}
  <rect x="62" y="96" width="14" height="6" rx="2" fill="#A9A3E0"/>
  <g transform="rotate(-12 38 99)"><rect x="14" y="80" width="48" height="38" rx="6" fill="#CCFF00"/><path d="M30 80v38M46 80v38M14 99h48" stroke="#0B1020" stroke-width="2.6" opacity="0.55"/></g>
  <rect x="124" y="96" width="14" height="6" rx="2" fill="#A9A3E0"/>
  <g transform="rotate(12 162 99)"><rect x="138" y="80" width="48" height="38" rx="6" fill="#CCFF00"/><path d="M154 80v38M170 80v38M138 99h48" stroke="#0B1020" stroke-width="2.6" opacity="0.55"/></g>
  <line x1="100" y1="58" x2="100" y2="34" stroke="#C9C3F7" stroke-width="4" stroke-linecap="round"/>
  <circle cx="100" cy="30" r="10" fill="#CCFF00" opacity="0.3"/><circle cx="100" cy="30" r="7" fill="#CCFF00"/>
  <rect x="66" y="54" width="68" height="92" rx="34" fill="url(#b)"/>
  <rect x="74" y="72" width="52" height="44" rx="20" fill="url(#v)"/>
  ${eye}
  <rect x="92" y="126" width="16" height="5" rx="2.5" fill="#CCFF00" opacity="0.8"/>
  ${orbit ? `<path d="M28 128 C 30 160, 170 160, 172 128" fill="none" stroke="#CCFF00" stroke-width="5" stroke-linecap="round"/>` : ""}
</svg>`;
}

export const satelliteDataUri = (opts?: Parameters<typeof satelliteSvg>[0]) => `data:image/svg+xml;base64,${Buffer.from(satelliteSvg(opts)).toString("base64")}`;
