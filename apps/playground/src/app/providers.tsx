'use client';

import { PockeyProvider } from '@pockey/react';
import type { ReactNode } from 'react';

// Local defaults match the seed app and the dev ports (DECISIONS.md).
const APP_ID = process.env.NEXT_PUBLIC_POCKEY_APP_ID ?? 'pk_app_seed00000000000000000001';
const EMBED_URL = process.env.NEXT_PUBLIC_POCKEY_EMBED_URL ?? 'http://localhost:5174';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PockeyProvider
      appId={APP_ID}
      embedUrl={EMBED_URL}
      config={{
        chains: { evm: [84532, 8453], solana: ['devnet'] },
        appearance: { theme: 'system' },
      }}
    >
      {children}
    </PockeyProvider>
  );
}
