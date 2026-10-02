import { ImageResponse } from "next/og";
import { satelliteDataUri } from "@/lib/brand/satelliteSvg";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iOS. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(150deg, #2b2a8f, #15195a 55%, #0b0f2e)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={satelliteDataUri()} width={176} height={176} alt="" style={{ marginTop: 10 }} />
      </div>
    ),
    size,
  );
}
