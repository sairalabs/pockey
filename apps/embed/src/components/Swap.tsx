import type { ReactNode } from 'react';

/**
 * Cross-fades two states kept in the DOM: scale 0.25 to 1, opacity, blur 4px,
 * 300ms cubic-bezier(0.2, 0, 0, 1). The larger layer defines the size.
 */
export function Swap({ swapped, from, to }: { swapped: boolean; from: ReactNode; to: ReactNode }) {
  return (
    <span className="pk-swap">
      <span className="pk-swap-layer" data-shown={String(!swapped)} aria-hidden={swapped}>
        {from}
      </span>
      <span className="pk-swap-layer" data-shown={String(swapped)} aria-hidden={!swapped}>
        {to}
      </span>
    </span>
  );
}
