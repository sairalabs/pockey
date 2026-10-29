/* Film grain, as a tile rather than an image file. Large flat gradients band on
   an ordinary screen, and a little noise over them is what stops it. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** Noise over whatever it is laid on. The parent has to be positioned. */
export function Grain({ opacity = 0.07 }: { opacity?: number }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{ backgroundImage: GRAIN, backgroundSize: '180px 180px', opacity }}
    />
  );
}
