'use client';

import Image, { type StaticImageData } from 'next/image';
import { useState } from 'react';

export interface Skin {
  /** The preset, named by what it actually sets. */
  name: string;
  src: StaticImageData;
  /** The appearance object that produced this capture. */
  line: string;
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
  const current = skins[active];

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
            className="absolute left-1/2 top-10 w-[210px] -translate-x-1/2 rounded-[18px] shadow-[0_30px_60px_-24px_rgba(0,0,0,0.55)] sm:top-14 sm:w-[260px]"
          />
        </div>
      ))}

      {/* The controls belong to this page, not to the skin, so they keep their
          own dark slab whichever theme is showing behind them. */}
      <div className="relative z-10 mt-auto p-4 sm:p-6">
        <div className="rounded-[20px] bg-black/55 p-4 backdrop-blur-md sm:p-5">
          <div className="flex flex-wrap gap-2">
            {skins.map((skin, index) => (
              <button
                key={skin.name}
                type="button"
                aria-pressed={index === active}
                onClick={() => {
                  setActive(index);
                }}
                className={`rounded-pill px-4 py-2 text-[13px] transition-colors ${
                  index === active
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {skin.name}
              </button>
            ))}
          </div>
          {/* The appearance line scrolls on its own rather than widening the page. */}
          <p className="code-face mt-4 max-w-full overflow-x-auto text-[13px] text-white/60">
            {current?.line}
          </p>
        </div>
      </div>
    </div>
  );
}
