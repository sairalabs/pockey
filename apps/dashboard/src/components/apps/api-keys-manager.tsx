'use client';

import type { ApiKeyId } from '@pocketkey/types';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative } from '@/lib/format';
import { apiKeys as seed, type ApiKeySummary } from '@/lib/mock-data';

const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomSuffix(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
}

export function useApiKeys() {
  const [keys, setKeys] = useState<readonly ApiKeySummary[]>(seed);
  const [revealed, setRevealed] = useState<string | null>(null);

  const create = () => {
    // TODO(T5.1): POST /admin/apps/:id/keys; the API returns the secret once.
    const suffix = randomSuffix(23);
    const secret = `pk_sk_s${suffix}`;
    const next: ApiKeySummary = {
      id: `key_s${randomSuffix(23)}` as ApiKeyId,
      prefix: secret.slice(0, 12),
      name: `Key ${keys.length + 1}`,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    setKeys((current) => [next, ...current]);
    setRevealed(secret);
  };

  const revoke = (id: ApiKeyId) => {
    // TODO(T5.1): DELETE /admin/apps/:id/keys/:keyId.
    setKeys((current) => current.filter((key) => key.id !== id));
  };

  const dismissRevealed = () => {
    setRevealed(null);
  };

  return { keys, revealed, dismissRevealed, create, revoke };
}

export interface ApiKeysListProps {
  keys: readonly ApiKeySummary[];
  revealed: string | null;
  onDismissRevealed: () => void;
  onRevoke: (id: ApiKeyId) => void;
  compact?: boolean;
}

export function ApiKeysList({
  keys,
  revealed,
  onDismissRevealed,
  onRevoke,
  compact = false,
}: ApiKeysListProps) {
  return (
    <div className="flex flex-col gap-4">
      {revealed ? (
        <div className="rounded-[12px] bg-surface-2 p-4 shadow-border">
          <p className="text-sm font-medium">Copy your new secret key now</p>
          <p className="mt-0.5 text-[13px] text-fg-2">
            It is shown once. Only its hash and prefix are stored.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-[8px] bg-bg px-3 py-2 tabular-nums text-[13px]">
            <span className="flex-1 truncate">{revealed}</span>
            <CopyButton value={revealed} label="Copy secret key" />
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" size="sm" onClick={onDismissRevealed}>
              Done
            </Button>
          </div>
        </div>
      ) : null}

      {keys.length === 0 ? (
        <EmptyState
          icon={<KeyRound strokeWidth={1.5} />}
          title="No API keys"
          description="Create a key to call the API from your server."
        />
      ) : (
        <ul className="divide-y divide-border">
          {keys.map((key) => (
            <li
              key={key.id}
              className={cn('flex items-center justify-between gap-4', compact ? 'py-3' : 'py-4')}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{key.name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-fg-2">
                  <span className="tabular-nums">{key.prefix}...</span>
                  <span>Created {formatDate(key.createdAt)}</span>
                  <span className="num">Last used {formatRelative(key.lastUsedAt)}</span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:text-danger"
                onClick={() => {
                  onRevoke(key.id);
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
