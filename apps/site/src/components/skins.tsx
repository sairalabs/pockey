'use client';

import Image, { type StaticImageData } from 'next/image';
import { useLayoutEffect, useRef, useState } from 'react';

export interface Skin {
  /** The preset, named by what it actually sets. */
  name: string;
  src: StaticImageData;
  /** The page behind the modal wears the theme too. */
  stage: string;
}

/**
 * The same login screen, four skins, swapped on click. Every frame is a real
 * capture of the modal taken by `pnpm --filter @pockey/site shots`, so what a
 * visitor flips through is what their own users would get.
 */
export function Skins({ skins }: { skins: Skin[] }) {
  const [active, setActive] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState({ x: 0, width: 0 });

  // The pill is told where to sit by the tab itself, so it follows a label of
  // any length and survives a resize or a late font.
  useLayoutEffect(() => {
    const place = () => {
      const tab = tabs.current[active];
      if (tab) setPill({ x: tab.offsetLeft, width: tab.offsetWidth });
    };
    place();
    const box = track.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(place);
    watch.observe(box);
    return () => {
      watch.disconnect();
    };
  }, [active]);

  return (
    <div className="relative mt-10 flex h-[560px] flex-col overflow-hidden rounded-[28px] sm:h-[660px]">
      {/* The frames are the same screen at the same size, so they cross-fade in
          place rather than resize the stage. */}
      {skins.map((skin, index) => (
        <div
          key={skin.name}
          aria-hidden={index !== active}
          className="absolute inset-0 transition-opacity duration-300"
          style={{ background: skin.stage, opacity: index === active ? 1 : 0 }}
        >
          <Image
            src={skin.src}
            alt={`The login screen, ${skin.name.toLowerCase()}`}
            sizes="300px"
            priority={index === 0}
            className="absolute left-1/2 top-10 w-[210px] -translate-x-1/2 rounded-[18px] sm:top-14 sm:w-[260px]"
          />
        </div>
      ))}

      {/* The controls belong to this page, not to the skin, so the track keeps
          its own fill and reads over a light theme as well as a dark one. */}
      <div className="relative z-10 mt-auto flex justify-center overflow-x-auto p-5 sm:p-7">
        <div
          ref={track}
          role="tablist"
          aria-label="Appearance presets"
          className="relative flex w-max gap-1 rounded-pill bg-black/70 p-1 backdrop-blur-md"
        >
          <span
            aria-hidden="true"
            className="absolute bottom-1 left-0 top-1 rounded-pill bg-white transition-[transform,width] duration-300 ease-out motion-reduce:transition-none"
            style={{ transform: `translateX(${String(pill.x)}px)`, width: pill.width }}
          />
          {skins.map((skin, index) => (
            <button
              key={skin.name}
              ref={(el) => {
                tabs.current[index] = el;
              }}
              type="button"
              role="tab"
              aria-selected={index === active}
              onClick={() => {
                setActive(index);
              }}
              className={`relative rounded-pill px-4 py-2 text-[13px] transition-colors ${
                index === active ? 'text-black' : 'text-white/75 hover:text-white'
              }`}
            >
              {skin.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
