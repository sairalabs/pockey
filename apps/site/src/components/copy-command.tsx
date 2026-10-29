'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from './icons';

/**
 * The one line that starts everything, with a button that takes it. Clipboard
 * access can be refused, so the line stays selectable either way.
 */
export function CopyCommand({ command }: { command: string }) {
  const [taken, setTaken] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return; // Refused, and the line is still there to select.
    }
    setTaken(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setTaken(false);
    }, 1600);
  };

  return (
    <div className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-control bg-surface-2 py-1.5 pl-5 pr-1.5">
      <code className="code-face overflow-x-auto text-[13.5px] text-fg-2">{command}</code>
      <button
        type="button"
        onClick={() => {
          void copy();
        }}
        aria-label={taken ? 'Copied' : 'Copy the command'}
        className="shrink-0 rounded-control p-2 text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg"
      >
        {taken ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}
