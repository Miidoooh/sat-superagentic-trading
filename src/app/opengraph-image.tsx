import { ImageResponse } from "next/og";
import { satelliteDataUri } from "@/lib/brand/satelliteSvg";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "SAT — Your satellite over Robinhood Chain";

/** The card people see when sathood.xyz is shared. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 90px",
          gap: 50,
          background: "radial-gradient(900px 500px at 75% 110%, rgba(109,91,255,0.45), transparent 60%), radial-gradient(600px 300px at 10% 0%, rgba(204,255,0,0.12), transparent 60%), #070A14",
          color: "#EAF0F7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", padding: "8px 16px", borderRadius: 999, background: "rgba(204,255,0,0.12)", border: "2px solid rgba(204,255,0,0.4)", color: "#CCFF00", fontSize: 22, fontWeight: 700 }}>
              LIVE ON ROBINHOOD CHAIN
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 120, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }}>SAT</div>
          <div style={{ display: "flex", fontSize: 50, fontWeight: 700, lineHeight: 1.1, color: "#CCFF00" }}>Your satellite over Robinhood Chain</div>
          <div style={{ display: "flex", fontSize: 26, color: "#B4BCDB" }}>Whales, hot launches and every move, spotted first.</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={satelliteDataUri({ mood: "whale" })} width={420} height={420} alt="" />
      </div>
    ),
    size,
  );
}
