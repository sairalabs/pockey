'use client';

import { useState } from 'react';
import { SwitchRow } from '@/components/ui/switch';
import { Pane } from './pane';

const rows = [
  { id: 'usage', title: 'Usage alerts', description: 'When an app crosses 80% of its daily cap.' },
  { id: 'billing', title: 'Billing emails', description: 'Invoices and failed payments.' },
  { id: 'security', title: 'Security alerts', description: 'New API keys and member changes.' },
  { id: 'product', title: 'Product updates', description: 'SDK releases, about once a month.' },
] as const;

type RowId = (typeof rows)[number]['id'];

export function NotificationsPane() {
  const [enabled, setEnabled] = useState<Record<RowId, boolean>>({
    usage: true,
    billing: true,
    security: true,
    product: false,
  });

  return (
    <Pane title="Notifications">
      <div className="divide-y divide-border">
        {rows.map((row) => (
          <SwitchRow
            key={row.id}
            title={row.title}
            description={row.description}
            checked={enabled[row.id]}
            onCheckedChange={(checked) => {
              // TODO(T5.1): persist notification preferences.
              setEnabled((current) => ({ ...current, [row.id]: checked }));
            }}
          />
        ))}
      </div>
    </Pane>
  );
}
