'use client';

import { useState } from 'react';
import { SwitchRow } from '@/components/ui/switch';
import { Pane } from './pane';

const rows = [
  {
    id: 'reduceMotion',
    title: 'Reduce motion',
    description: 'Keeps fades, removes movement. Follows your system setting by default.',
  },
  { id: 'compact', title: 'Compact density', description: 'Tighter rows in tables and lists.' },
  {
    id: 'usd',
    title: 'Show amounts in USD',
    description: 'Gas and balances converted at the current rate.',
  },
] as const;

type RowId = (typeof rows)[number]['id'];

export function AppearancePane() {
  const [enabled, setEnabled] = useState<Record<RowId, boolean>>({
    reduceMotion: false,
    compact: false,
    usd: true,
  });

  return (
    <Pane title="Appearance">
      <p className="mb-2 text-[13px] text-fg-2">
        The dashboard ships in dark only for now. A light theme follows the same tokens.
      </p>
      <div className="">
        {rows.map((row) => (
          <SwitchRow
            key={row.id}
            title={row.title}
            description={row.description}
            checked={enabled[row.id]}
            onCheckedChange={(checked) => {
              // TODO(T5.1): persist preferences per developer.
              setEnabled((current) => ({ ...current, [row.id]: checked }));
            }}
          />
        ))}
      </div>
    </Pane>
  );
}
