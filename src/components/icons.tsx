/** Small line icons, drawn on a 24px grid and coloured by currentColor. */

const base = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const IconHome = () => (
  <svg {...base} aria-hidden>
    <circle cx="12" cy="11" r="4" />
    <ellipse cx="12" cy="13" rx="9.5" ry="3.2" />
    <path d="M12 7V4" />
  </svg>
);
export const IconTerminal = () => (
  <svg {...base} aria-hidden>
    <path d="M3 3v18h18" />
    <path d="M7 15l4-4 3 3 5-6" />
  </svg>
);
export const IconExplore = () => (
  <svg {...base} aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5l-2 5-5 2 2-5z" />
  </svg>
);
export const IconRadar = () => (
  <svg {...base} aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <path d="M12 12l6-6" />
  </svg>
);
export const IconFlame = () => (
  <svg {...base} aria-hidden>
    <path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 1.6 1 2.6 2 3-.5-3 .5-6 .5-8z" />
  </svg>
);
export const IconBrain = () => (
  <svg {...base} aria-hidden>
    <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V6a2 2 0 0 0-3-2z" />
    <path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1" />
  </svg>
);
export const IconPie = () => (
  <svg {...base} aria-hidden>
    <path d="M21 12a9 9 0 1 1-9-9v9z" />
    <path d="M15 3.5A9 9 0 0 1 20.5 9H15z" />
  </svg>
);
export const IconDiamond = () => (
  <svg {...base} aria-hidden>
    <path d="M6 3h12l3 6-9 12L3 9z" />
    <path d="M3 9h18M9 3l3 18 3-18" />
  </svg>
);
export const IconReport = () => (
  <svg {...base} aria-hidden>
    <path d="M7 3h7l5 5v13H7z" />
    <path d="M14 3v5h5M10 13h6M10 17h4" />
  </svg>
);
export const IconWallet = () => (
  <svg {...base} aria-hidden>
    <rect x="3" y="6" width="18" height="14" rx="3" />
    <path d="M16 13h2M3 10h18M6 6V5a2 2 0 0 1 2-2h9" />
  </svg>
);
export const IconSearch = () => (
  <svg {...base} aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);
export const IconBell = () => (
  <svg {...base} aria-hidden>
    <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);
export const IconBolt = () => (
  <svg {...base} aria-hidden>
    <path d="M13 3L5 14h6l-1 7 8-11h-6z" />
  </svg>
);
export const IconAgent = () => (
  <svg {...base} aria-hidden>
    <rect x="5" y="8" width="14" height="11" rx="4" />
    <path d="M12 8V4.5" />
    <circle cx="12" cy="3.5" r="1" />
    <circle cx="9.5" cy="13.5" r="1.2" />
    <circle cx="14.5" cy="13.5" r="1.2" />
    <path d="M2.5 12.5v3M21.5 12.5v3" />
  </svg>
);
