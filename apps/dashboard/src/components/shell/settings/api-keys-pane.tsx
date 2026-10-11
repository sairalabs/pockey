'use client';

import { Plus } from '../../ui/icons';
import { useEffect, useState } from 'react';
import { ApiKeysList, NewApiKeyDialog, useApiKeys } from '@/components/apps/api-keys-manager';
import { Button } from '@/components/ui/button';
import { Pane } from './pane';

export function ApiKeysPane({ appId }: { appId: string }) {
  const { keys, revealed, pending, error, create, revoke, reload, dismissRevealed } = useApiKeys(
    appId,
    [],
  );
  const [creating, setCreating] = useState(false);

  // The dialog opens without the keys page ever being visited, so load them here.
  useEffect(() => {
    void reload().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one load per app id
  }, [appId]);

  return (
    <Pane
      title="API keys"
      actions={
        <Button
          variant="primary"
          size="sm"
          iconStart={<Plus />}
          onClick={() => {
            setCreating(true);
          }}
        >
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
        pending={pending}
        error={error}
        onDismissRevealed={dismissRevealed}
        onRevoke={revoke}
      />
      <NewApiKeyDialog
        open={creating}
        onOpenChange={setCreating}
        pending={pending}
        onCreate={create}
      />
    </Pane>
  );
}
