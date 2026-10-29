'use client';

import { useEffect, useRef } from 'react';

/* The characters a wallet is made of, and nothing that reads as a word. */
const GLYPHS = '0123456789abcdefx<>{}[]()=+-/*&%$#@!?';

interface AsciiFieldProps {
  /** Distance between characters, in CSS pixels. */
  cell?: number;
  /** How bright the field is with no pointer anywhere near it. */
  base?: number;
  /** How far the pointer reaches, in CSS pixels. Zero means it does not. */
  reach?: number;
  /** The colour of a character, as `r, g, b`. */
  tint?: string;
}

/**
 * A field of characters on a grid, swelling with a slow wave and lighting up
 * under the pointer. The grid does the aligning, so the site font is used here
 * like everywhere else rather than a monospace one.
 *
 * It paints on a canvas rather than in the DOM: twelve thousand animated spans
 * would cost a great deal more than one frame of fillText.
 */
export function AsciiField({ cell = 17, base = 0.05, reach = 190, tint }: AsciiFieldProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const box = host.current;
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!box || !el || !ctx) return;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hovers = window.matchMedia('(pointer: fine)').matches;
    const colour = tint ?? '123, 107, 255';

    const dpr = Math.min(window.devicePixelRatio, 2);
    let w = 0;
    let h = 0;
    let cells: string[] = [];
    let cols = 0;
    let rows = 0;

    const pick = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? '0';

    const size = () => {
      const rect = el.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / cell);
      rows = Math.ceil(h / cell);
      cells = Array.from({ length: cols * rows }, pick);
    };

    const at = { x: -9999, y: -9999, near: 0 };
    const move = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      at.x = event.clientX - rect.left;
      at.y = event.clientY - rect.top;
      at.near = 1;
    };
    const gone = () => {
      at.near = 0;
    };

    size();
    const watch = new ResizeObserver(size);
    watch.observe(el);

    if (hovers && reach > 0) {
      window.addEventListener('pointermove', move, { passive: true });
      box.addEventListener('pointerleave', gone);
    }

    const start = performance.now();
    let frame = 0;

    const draw = (seconds: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.font = `12px ${getComputedStyle(box).fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const index = row * cols + col;
          const x = col * cell + cell / 2;
          const y = row * cell + cell / 2;

          // A swell crossing the field, so it breathes with no pointer on it.
          const wave = Math.sin((x + y) * 0.006 - seconds * 0.9) * 0.5 + 0.5;
          let light = base * (0.35 + wave);

          if (at.near) {
            const near = Math.max(0, 1 - Math.hypot(x - at.x, y - at.y) / reach);
            light += near * near * 0.8;
            // Only the characters the pointer is over keep changing.
            if (near > 0.25 && Math.random() < 0.06) cells[index] = pick();
          }

          if (light < 0.012) continue;
          ctx.fillStyle = `rgba(${colour}, ${Math.min(light, 0.9).toFixed(3)})`;
          ctx.fillText(cells[index] ?? '0', x, y);
        }
      }
    };

    if (still) {
      draw(0);
    } else {
      frame = requestAnimationFrame(function loop(now) {
        draw((now - start) / 1000);
        frame = requestAnimationFrame(loop);
      });
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      watch.disconnect();
      window.removeEventListener('pointermove', move);
      box.removeEventListener('pointerleave', gone);
    };
  }, [cell, base, reach, tint]);

  return (
    <div ref={host} aria-hidden="true" className="pointer-events-none absolute inset-0">
      <canvas ref={canvas} className="absolute inset-0 size-full" />
    </div>
  );
}
