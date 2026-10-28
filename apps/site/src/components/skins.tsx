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
    <div className="mt-10 grid gap-4 lg:grid-cols-[0.9fr_1fr]">
      {/* min-w-0: the appearance line below must scroll, not widen the column. */}
      <div className="flex min-w-0 flex-col justify-between gap-10 rounded-[28px] bg-surface p-8 sm:p-10">
        <div>
          <h3 className="text-[24px] font-semibold tracking-[-0.01em]">
            The same screen, wearing your brand
          </h3>
          <p className="mt-3 text-[15px] leading-[1.6] text-fg-2">
            Theme, accent, corners, font and logo. Set them once on the app, or send them with a
            single login when a user should see something else.
          </p>
        </div>

        <div>
          <p className="text-[13px] text-fg-3">Try a preset</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
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
                    : 'bg-surface-2 text-fg-2 hover:bg-surface-3'
                }`}
              >
                {skin.name}
              </button>
            ))}
          </div>
          <p className="code-face mt-4 max-w-full overflow-x-auto rounded-control bg-surface-2 px-4 py-3 text-[13px] text-fg-2">
            {current?.line}
          </p>
        </div>
      </div>

      {/* The frames are the same screen at the same size, so they cross-fade in
          place rather than resize the stage. */}
      <div className="relative h-[380px] overflow-hidden rounded-[28px] sm:h-[460px]">
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
              className="absolute left-1/2 top-10 w-[230px] -translate-x-1/2 rounded-[18px] shadow-[0_30px_60px_-24px_rgba(0,0,0,0.55)] sm:top-14 sm:w-[260px]"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
