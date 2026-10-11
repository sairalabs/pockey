import { Check, Copy } from './icons';
import { useEffect, useState } from 'react';
import { IconButton } from './Button';
import { Swap } from './Swap';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  return (
    <IconButton
      label={copied ? 'Copied' : label}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
          },
          () => undefined,
        );
      }}
    >
      <Swap
        swapped={copied}
        from={<Copy size={16} aria-hidden="true" />}
        to={<Check size={16} aria-hidden="true" />}
      />
    </IconButton>
  );
}
