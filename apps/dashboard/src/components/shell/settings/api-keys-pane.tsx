'use client';

import { Plus } from 'lucide-react';
import { ApiKeysList, useApiKeys } from '@/components/apps/api-keys-manager';
import { Button } from '@/components/ui/button';
import { Pane } from './pane';

export function ApiKeysPane() {
  const { keys, revealed, dismissRevealed, create, revoke } = useApiKeys();

  return (
    <Pane
      title="API keys"
      actions={
        <Button variant="primary" size="sm" iconStart={<Plus strokeWidth={2} />} onClick={create}>
          Create key
        </Button>
      }
    >
      <p className="mb-2 text-[13px] text-fg-2">
        Secret keys authenticate your server. Never ship one in a browser bundle.
      </p>
      <ApiKeysList
        compact
        keys={keys}
        revealed={revealed}
        onDismissRevealed={dismissRevealed}
        onRevoke={revoke}
      />
    </Pane>
  );
}
