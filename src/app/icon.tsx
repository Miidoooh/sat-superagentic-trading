import { ImageResponse } from "next/og";
import { satelliteDataUri } from "@/lib/brand/satelliteSvg";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Browser tab icon: the satellite on its navy tile. */
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 16, background: "linear-gradient(150deg, #2b2a8f, #15195a 55%, #0b0f2e)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={satelliteDataUri()} width={66} height={66} alt="" style={{ marginTop: 4 }} />
      </div>
    ),
    size,
  );
}
