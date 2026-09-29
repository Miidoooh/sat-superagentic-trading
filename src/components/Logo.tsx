import Image from "next/image";

/**
 * The source artwork is a square with generous padding around the glyph, so it
 * is cropped in slightly to stay legible at small sizes. The lime field is part
 * of the art, which is why the tile needs no background of its own.
 */
export default function Logo({ size = 28, radius = 7 }: { size?: number; radius?: number }) {
  return (
    <span className="logo-tile" style={{ width: size, height: size, borderRadius: radius }}>
      <Image src="/logo.png" alt="SAT" width={size * 2} height={size * 2} priority />
    </span>
  );
}
