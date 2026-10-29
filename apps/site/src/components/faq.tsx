'use client';

import { useId, useState } from 'react';
import { ChevronDown } from './icons';

interface FaqItem {
  q: string;
  a: string;
}

/**
 * One question open at a time. The panel animates on grid rows rather than on a
 * guessed height, so a long answer opens as smoothly as a short one.
 */
export function Faq({ items }: { items: readonly FaqItem[] }) {
  const base = useId();
  const [open, setOpen] = useState(0);

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => {
        const expanded = open === index;
        return (
          <div key={item.q} className="overflow-hidden rounded-card bg-surface">
            <h3>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`${base}-${index}`}
                onClick={() => {
                  setOpen(expanded ? -1 : index);
                }}
                className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left text-[16px] font-medium text-fg transition-colors hover:bg-surface-2"
              >
                {item.q}
                <ChevronDown
                  size={18}
                  className={`shrink-0 text-fg-2 transition-transform duration-200 ${
                    expanded ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </h3>
            <div
              id={`${base}-${index}`}
              role="region"
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <div className="overflow-hidden">
                <p className="px-6 pb-5 text-[15px] leading-[1.6] text-fg-2">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
