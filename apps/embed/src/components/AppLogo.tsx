import { useState } from 'react';

function resolveLogo(logo: string | undefined, hostOrigin: string | null): string | null {
  if (!logo) return null;
  try {
    const url = hostOrigin ? new URL(logo, hostOrigin) : new URL(logo);
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'data:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** 40px, 12px radius, 1px image outline. Falls back to the first letter on the accent. */
export function AppLogo({
  name,
  logo,
  hostOrigin,
}: {
  name: string;
  logo?: string | undefined;
  hostOrigin: string | null;
}) {
  const src = resolveLogo(logo, hostOrigin);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt=""
        width={40}
        height={40}
        className="size-10 rounded-xl object-cover"
        onError={() => {
          setFailedSrc(src);
        }}
      />
    );
  }
  const letter = name.trim().charAt(0).toUpperCase() || 'P';
  return (
    <div
      aria-hidden="true"
      className="flex size-10 items-center justify-center rounded-xl bg-accent text-[18px] font-semibold text-accent-fg"
    >
      {letter}
    </div>
  );
}
