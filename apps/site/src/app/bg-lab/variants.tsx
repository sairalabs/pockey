'use client';

import { type RefObject, useEffect, useRef } from 'react';
import { AsciiField } from '@/components/ascii-field';
import { Grain } from '@/components/grain';

/* Five backgrounds for the hero, side by side so they can be judged against
   the sentence they sit behind. Throwaway: one of them moves into
   `hero-glow.tsx` and this folder goes.

   The palette is the brand accent and the lighter indigo the word "own" is
   filled with, on the page colour. Nothing here introduces a sixth colour. */
const ACCENT = '65, 50, 236';
const LIT = '123, 107, 255';

/** Where the pointer is inside an element, and whether it is there at all. */
function usePointer(host: RefObject<HTMLElement | null>) {
  const at = useRef({ x: -9999, y: -9999, near: 0 });

  useEffect(() => {
    const el = host.current;
    if (!el || !window.matchMedia('(pointer: fine)').matches) return;

    const move = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      at.current.x = event.clientX - box.left;
      at.current.y = event.clientY - box.top;
      at.current.near = 1;
    };
    const gone = () => {
      at.current.near = 0;
    };

    window.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerleave', gone);
    return () => {
      window.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', gone);
    };
  }, [host]);

  return at;
}

/**
 * A canvas that keeps its backing store in step with its box and calls the
 * painter once a frame, in CSS pixels. The painter is read from a ref, so a
 * closure over fresh state never restarts the loop.
 */
function useCanvas(
  canvas: RefObject<HTMLCanvasElement | null>,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number, seconds: number) => void,
) {
  const painter = useRef(paint);
  painter.current = paint;

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const dpr = Math.min(window.devicePixelRatio, 2);
    let w = 0;
    let h = 0;

    const size = () => {
      const box = el.getBoundingClientRect();
      w = box.width;
      h = box.height;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    size();
    const watch = new ResizeObserver(size);
    watch.observe(el);

    const start = performance.now();
    let frame = requestAnimationFrame(function loop(now) {
      painter.current(ctx, w, h, (now - start) / 1000);
      frame = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, [canvas]);
}

/** The page coming back at the corners, over whatever is painted. */
function Vignette() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{ background: 'radial-gradient(120% 90% at 50% 20%, transparent 40%, #101010 100%)' }}
    />
  );
}

/* ---------- 1. Nappes: three lights drifting, the pointer leans them ------- */

export function Nappes() {
  const host = useRef<HTMLDivElement>(null);
  const at = usePointer(host);
  const field = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = field.current;
    if (!el) return;
    let frame = 0;
    let x = 0;
    let y = 0;

    frame = requestAnimationFrame(function loop() {
      const box = host.current?.getBoundingClientRect();
      if (box) {
        const toX = at.current.near ? (at.current.x / box.width - 0.5) * 52 : 0;
        const toY = at.current.near ? (at.current.y / box.height - 0.5) * 52 : 0;
        x += (toX - x) * 0.06;
        y += (toY - y) * 0.06;
        el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      }
      frame = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [at]);

  return (
    <div ref={host} className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div ref={field} className="absolute inset-0">
        <span className="hero-drift-a absolute left-1/2 top-[-14%] h-[34rem] w-[64rem] -translate-x-1/2 rounded-pill bg-accent/45 blur-[150px]" />
        <span className="hero-drift-b absolute right-[6%] top-[4%] h-[20rem] w-[32rem] rounded-pill bg-[#7b6bff]/25 blur-[150px]" />
        <span className="hero-drift-c absolute bottom-[-6%] left-[14%] h-[26rem] w-[52rem] rounded-pill bg-[#1a1270]/80 blur-[150px]" />
      </div>
      <Grain />
      <Vignette />
    </div>
  );
}

/* ---------- 2. Keys: a field of characters, brighter under the pointer ----- */

export function Keys() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <span className="absolute left-1/2 top-[-18%] h-[32rem] w-[58rem] -translate-x-1/2 rounded-pill bg-accent/30 blur-[160px]" />
      <AsciiField base={0.06} />
      <Grain opacity={0.05} />
      <Vignette />
    </div>
  );
}

/* ---------- 3. Flow: threads on a slow current, pushed aside by the pointer */

interface Thread {
  x: number;
  y: number;
}

export function Flow() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const at = usePointer(host);
  const threads = useRef<Thread[]>([]);

  useCanvas(canvas, (ctx, w, h, seconds) => {
    if (threads.current.length === 0) {
      threads.current = Array.from({ length: 520 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
      }));
    }

    // The trails are kept by painting the page colour over them, not by
    // clearing: what was drawn last frame fades instead of blinking out.
    ctx.fillStyle = 'rgba(16, 16, 16, 0.05)';
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1;

    const { x: px, y: py, near } = at.current;

    for (const thread of threads.current) {
      // A cheap standing field: two sines crossing, drifting with the clock.
      const angle =
        Math.sin(thread.x * 0.0022 + seconds * 0.1) * 1.6 +
        Math.cos(thread.y * 0.0026 - seconds * 0.08) * 1.6;
      let dx = Math.cos(angle) * 0.9;
      let dy = Math.sin(angle) * 0.9;

      if (near) {
        const ox = thread.x - px;
        const oy = thread.y - py;
        const d = Math.hypot(ox, oy);
        if (d < 170 && d > 0.01) {
          const push = (1 - d / 170) ** 2 * 3.4;
          dx += (ox / d) * push;
          dy += (oy / d) * push;
        }
      }

      ctx.strokeStyle = `rgba(${LIT}, 0.3)`;
      ctx.beginPath();
      ctx.moveTo(thread.x, thread.y);
      thread.x += dx;
      thread.y += dy;
      ctx.lineTo(thread.x, thread.y);
      ctx.stroke();

      if (thread.x < 0 || thread.x > w || thread.y < 0 || thread.y > h) {
        thread.x = Math.random() * w;
        thread.y = Math.random() * h;
      }
    }
  });

  return (
    <div ref={host} className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      {/* Over the threads, not under: the canvas paints the page colour to fade
          its own trails, and would bury a light placed behind it. */}
      <span className="absolute left-1/2 top-[-20%] h-[34rem] w-[60rem] -translate-x-1/2 rounded-pill bg-accent/35 blur-[160px]" />
      <Grain opacity={0.05} />
      <Vignette />
    </div>
  );
}

/* ---------- 4. Mesh: colour points, one of them held by the pointer -------- */

export function Mesh() {
  const host = useRef<HTMLDivElement>(null);
  const at = usePointer(host);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    let frame = 0;
    let x = 50;
    let y = 30;

    frame = requestAnimationFrame(function loop() {
      const box = host.current?.getBoundingClientRect();
      if (box) {
        const toX = at.current.near ? (at.current.x / box.width) * 100 : 50;
        const toY = at.current.near ? (at.current.y / box.height) * 100 : 30;
        x += (toX - x) * 0.05;
        y += (toY - y) * 0.05;
        el.style.setProperty('--hx', `${x.toFixed(2)}%`);
        el.style.setProperty('--hy', `${y.toFixed(2)}%`);
      }
      frame = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [at]);

  return (
    <div ref={host} className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        ref={sheet}
        className="bg-mesh absolute inset-[-10%] [--hx:50%] [--hy:30%]"
        style={{
          backgroundImage: [
            `radial-gradient(42rem 26rem at var(--hx) var(--hy), rgba(${LIT}, 0.42), transparent 62%)`,
            `radial-gradient(40rem 30rem at 12% 8%, rgba(${ACCENT}, 0.55), transparent 60%)`,
            `radial-gradient(36rem 24rem at 88% 14%, rgba(${ACCENT}, 0.4), transparent 62%)`,
            `radial-gradient(44rem 28rem at 72% 92%, rgba(26, 18, 112, 0.85), transparent 65%)`,
            `radial-gradient(38rem 26rem at 22% 96%, rgba(${ACCENT}, 0.32), transparent 64%)`,
          ].join(','),
        }}
      />
      <Grain />
      <Vignette />
    </div>
  );
}

/* ---------- 5. Ribbons: wide bands, bent by the pointer -------------------- */

export function Ribbons() {
  const host = useRef<HTMLDivElement>(null);
  const at = usePointer(host);
  const bands = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bands.current;
    if (!el) return;
    let frame = 0;
    let tilt = 0;
    let lift = 0;

    frame = requestAnimationFrame(function loop() {
      const box = host.current?.getBoundingClientRect();
      if (box) {
        const toTilt = at.current.near ? (at.current.x / box.width - 0.5) * 7 : 0;
        const toLift = at.current.near ? (at.current.y / box.height - 0.5) * 46 : 0;
        tilt += (toTilt - tilt) * 0.05;
        lift += (toLift - lift) * 0.05;
        el.style.transform = `rotate(${tilt.toFixed(2)}deg) translateY(${lift.toFixed(2)}px)`;
      }
      frame = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [at]);

  return (
    <div ref={host} className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div ref={bands} className="absolute inset-[-25%]">
        <span className="ribbon-a absolute left-[-10%] top-[22%] h-[13rem] w-[120%] -rotate-12 rounded-pill bg-accent/55 blur-[90px]" />
        <span className="ribbon-b absolute left-[-10%] top-[42%] h-[9rem] w-[120%] -rotate-6 rounded-pill bg-[#7b6bff]/35 blur-[80px]" />
        <span className="ribbon-c absolute left-[-10%] top-[62%] h-[15rem] w-[120%] -rotate-[14deg] rounded-pill bg-[#1a1270]/80 blur-[100px]" />
      </div>
      <Grain />
      <Vignette />
    </div>
  );
}
