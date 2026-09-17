'use client';

import type { AdminApp, ApiKeySummary } from '@pocketkey/types';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ApiKeysList, NewApiKeyDialog, useApiKeys } from '@/components/apps/api-keys-manager';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';

export interface KeysViewProps {
  app: AdminApp;
  initialKeys: readonly ApiKeySummary[];
}

export function KeysView({ app, initialKeys }: KeysViewProps) {
  const { keys, revealed, pending, error, create, revoke, dismissRevealed } = useApiKeys(
    app.app.id,
    initialKeys,
  );
  const [creating, setCreating] = useState(false);

  return (
    <div className="stagger flex flex-col gap-6">
      <PageHeader
        title="API keys"
        description="The public id ships in your client bundle. Secret keys stay on your server."
        actions={
          <Button
            variant="primary"
            iconStart={<Plus strokeWidth={2} />}
            onClick={() => {
              setCreating(true);
            }}
          >
            Create key
          </Button>
        }
      />

      <Card className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium">Public app id</p>
          <p className="mt-0.5 text-[13px] text-fg-2">
            Pass it to the SDK provider. Requests are accepted only from the allowed origins.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-[10px] bg-surface-2 ps-3 pe-1 py-1">
          <span className="min-w-0 flex-1 truncate tabular-nums text-[13px]">
            {app.app.publicId}
          </span>
          <CopyButton value={app.app.publicId} label="Copy public app id" />
        </div>
        {app.app.allowedOrigins.length === 0 ? (
          <p className="text-[13px] text-fg-3">
            No allowed origin yet. Add one in Settings, App information, or the SDK is refused on
            every site.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {app.app.allowedOrigins.map((origin) => (
              <li
                key={origin}
                className="rounded-pill bg-surface-2 px-2.5 py-1 tabular-nums text-[12px] text-fg-2 shadow-border"
              >
                {origin}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <p className="text-sm font-medium">Secret keys</p>
        <p className="mt-0.5 mb-2 text-[13px] text-fg-2">
          Only the first 12 characters and a hash are stored. Rotate by creating a new key, then
          revoking the old one.
        </p>
        <ApiKeysList
          keys={keys}
          revealed={revealed}
          pending={pending}
          error={error}
          onDismissRevealed={dismissRevealed}
          onRevoke={revoke}
        />
      </Card>

      <NewApiKeyDialog
        open={creating}
        onOpenChange={setCreating}
        pending={pending}
        onCreate={create}
      />
    </div>
  );
}
