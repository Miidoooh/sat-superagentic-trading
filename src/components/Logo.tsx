import Satellite from "./brand/Satellite";

/** The SAT mark: the satellite on a navy-to-indigo tile, orbit included. */
export default function Logo({ size = 28, radius }: { size?: number; radius?: number }) {
  return (
    <span className="logo-tile sat-mark" style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.28) }}>
      <Satellite size={Math.round(size * 1.12)} still mood="watching" />
    </span>
  );
}
