'use client';

import { useEffect, useRef } from 'react';
import { AsciiField } from './ascii-field';
import { Grain } from './grain';

/**
 * Three wide bands crossing behind the sentence, undulating on their own
 * clocks, with a field of characters over them. The pointer tilts and lifts
 * the bands together, and lights the characters it passes.
 *
 * Kept dark on purpose: the colour is a hint of where the light comes from,
 * not the subject. The sentence is the subject.
 */
export function HeroGlow() {
  const host = useRef<HTMLDivElement>(null);
  const bands = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = host.current;
    const el = bands.current;
    // A finger has no hover, and bands that jump on tap are worse than still.
    if (!box || !el || !window.matchMedia('(pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let tilt = 0;
    let lift = 0;
    let toTilt = 0;
    let toLift = 0;

    const step = () => {
      tilt += (toTilt - tilt) * 0.05;
      lift += (toLift - lift) * 0.05;
      el.style.transform = `rotate(${tilt.toFixed(3)}deg) translateY(${lift.toFixed(2)}px)`;
      frame =
        Math.abs(toTilt - tilt) + Math.abs(toLift - lift) > 0.02 ? requestAnimationFrame(step) : 0;
    };

    const onMove = (event: PointerEvent) => {
      const rect = box.getBoundingClientRect();
      toTilt = (event.clientX - rect.left) / rect.width - 0.5;
      toTilt *= 6;
      toLift = ((event.clientY - rect.top) / rect.height - 0.5) * 44;
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
      ref={host}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div ref={bands} className="absolute inset-[-25%]">
        <span className="ribbon-a absolute left-[-10%] top-[22%] h-[13rem] w-[120%] -rotate-12 rounded-pill bg-accent/30 blur-[90px]" />
        <span className="ribbon-b absolute left-[-10%] top-[42%] h-[9rem] w-[120%] -rotate-6 rounded-pill bg-[#7b6bff]/15 blur-[80px]" />
        <span className="ribbon-c absolute left-[-10%] top-[62%] h-[15rem] w-[120%] -rotate-[14deg] rounded-pill bg-[#120c52]/80 blur-[100px]" />
      </div>

      {/* Masked away from the middle, so the characters frame the sentence
          rather than run under it. */}
      <div
        className="absolute inset-0"
        style={{
          maskImage: 'radial-gradient(50% 44% at 50% 50%, transparent 20%, #000 100%)',
          WebkitMaskImage: 'radial-gradient(50% 44% at 50% 50%, transparent 20%, #000 100%)',
        }}
      >
        <AsciiField base={0.045} />
      </div>
      <Grain />

      {/* The page comes back at the corners, and then at the bottom. */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(115% 85% at 50% 28%, transparent 22%, #101010 92%)' }}
      />
      <div className="absolute inset-x-0 bottom-0 h-56 bg-linear-to-b from-transparent to-bg" />
    </div>
  );
}
