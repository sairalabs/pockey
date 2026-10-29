'use client';

import { useEffect, useRef } from 'react';

/* Film grain, as a tile rather than an image file. Large flat gradients band on
   an ordinary screen, and a little noise over them is what stops it. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/**
 * Three lights behind the hero, each drifting on its own clock, under a layer
 * of grain. The pointer does not carry a spotlight around: it leans the whole
 * field a few pixels, the way a held object catches the light.
 *
 * The position travels as two custom properties on one element, so nothing
 * re-renders and the browser moves a single composited layer.
 */
export function HeroGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const field = ref.current;
    // A finger has no hover, and a light that jumps on tap is worse than none.
    if (!field || !window.matchMedia('(pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    /** How far the field leans, at the edges of the screen. */
    const REACH = 26;
    let frame = 0;
    let x = 0;
    let y = 0;
    let toX = 0;
    let toY = 0;

    const step = () => {
      x += (toX - x) * 0.06;
      y += (toY - y) * 0.06;
      field.style.setProperty('--px', `${x.toFixed(2)}px`);
      field.style.setProperty('--py', `${y.toFixed(2)}px`);
      frame = Math.abs(toX - x) + Math.abs(toY - y) > 0.1 ? requestAnimationFrame(step) : 0;
    };

    const onMove = (event: PointerEvent) => {
      const box = field.getBoundingClientRect();
      toX = ((event.clientX - box.left) / box.width - 0.5) * 2 * REACH;
      toY = ((event.clientY - box.top) / box.height - 0.5) * 2 * REACH;
      if (!frame) frame = requestAnimationFrame(step);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [--px:0px] [--py:0px]"
    >
      {/* Wide and low rather than round, so the lights read as one field and
          the brightest part of it sits behind the sentence. */}
      <div
        className="absolute inset-0"
        style={{ transform: 'translate3d(var(--px), var(--py), 0)' }}
      >
        <span className="hero-drift-a absolute left-1/2 top-[-14%] h-[34rem] w-[64rem] -translate-x-1/2 rounded-pill bg-accent/45 blur-[150px]" />
        <span className="hero-drift-b absolute right-[6%] top-[4%] h-[20rem] w-[32rem] rounded-pill bg-[#7b6bff]/25 blur-[150px]" />
        <span className="hero-drift-c absolute bottom-[-6%] left-[14%] h-[26rem] w-[52rem] rounded-pill bg-[#1a1270]/80 blur-[150px]" />
      </div>

      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: GRAIN, backgroundSize: '180px 180px' }}
      />
      {/* The page under it comes back, at the edges and then at the bottom. */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(120% 90% at 50% 20%, transparent 40%, #101010 100%)',
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-56 bg-linear-to-b from-transparent to-bg" />
    </div>
  );
}
