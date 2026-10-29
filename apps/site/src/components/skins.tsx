'use client';

import Image, { type StaticImageData } from 'next/image';
import { useState } from 'react';

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

      {/* The controls belong to this page, not to the skin, so each one carries
          its own fill and reads over a light theme as well as a dark one. */}
      <div className="relative z-10 mt-auto flex flex-wrap gap-2 p-5 sm:p-7">
        {skins.map((skin, index) => (
          <button
            key={skin.name}
            type="button"
            aria-pressed={index === active}
            onClick={() => {
              setActive(index);
            }}
            className={`rounded-pill px-4 py-2 text-[13px] backdrop-blur-md transition-colors ${
              index === active ? 'bg-white text-black' : 'bg-black/40 text-white hover:bg-black/60'
            }`}
          >
            {skin.name}
          </button>
        ))}
      </div>
    </div>
  );
}
