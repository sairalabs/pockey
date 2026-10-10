'use client';

import type { ApiKeySummary } from '@pockey/types';
import { KeyRound, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/input';
import { createApiKey, errorMessage, listApiKeys, revokeApiKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative } from '@/lib/format';

/**
 * Secret keys of one app (T5.1). The secret exists in this process for exactly
 * as long as the panel that shows it: it is never stored, never re-rendered
 * after the panel is dismissed, and the API only keeps its hash and prefix.
 */
export function useApiKeys(appId: string, initial: readonly ApiKeySummary[]) {
  const [keys, setKeys] = useState<readonly ApiKeySummary[]>(initial);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const list = await listApiKeys(appId);
    setKeys(list.keys);
  };

  const create = async (name: string | undefined) => {
    setPending(true);
    setError(null);
    try {
      const created = await createApiKey(appId, name);
      setRevealed(created.secret);
      await reload();
      return true;
    } catch (cause) {
      setError(errorMessage(cause, 'Could not create the key'));
      return false;
    } finally {
      setPending(false);
    }
  };

  const revoke = async (keyId: string) => {
    setPending(true);
    setError(null);
    try {
      await revokeApiKey(appId, keyId);
      await reload();
      return true;
    } catch (cause) {
      setError(errorMessage(cause, 'Could not revoke the key'));
      return false;
    } finally {
      setPending(false);
    }
  };

  const dismissRevealed = () => {
    setRevealed(null);
  };

  return { keys, revealed, pending, error, create, revoke, reload, dismissRevealed };
}

export interface NewApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onCreate: (name: string | undefined) => Promise<boolean>;
}

export function NewApiKeyDialog({ open, onOpenChange, pending, onCreate }: NewApiKeyDialogProps) {
  const id = useId();
  const [name, setName] = useState('');

  const submit = async () => {
    const trimmed = name.trim();
    const ok = await onCreate(trimmed.length > 0 ? trimmed : undefined);
    if (ok) {
      setName('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New secret key"
      description="The secret is shown once, right after it is created."
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Name"
          htmlFor={`${id}-name`}
          hint="Optional. Helps you recognize the key when you rotate it."
          counter={{ value: name.length, max: 60 }}
        >
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={60}
            autoFocus
            placeholder="Production server"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={pending}>
            {pending ? 'Creating' : 'Create key'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export interface ApiKeysListProps {
  keys: readonly ApiKeySummary[];
  revealed: string | null;
  pending: boolean;
  error: string | null;
  onDismissRevealed: () => void;
  onRevoke: (keyId: string) => Promise<boolean>;
  compact?: boolean;
}

export function ApiKeysList({
  keys,
  revealed,
  pending,
  error,
  onDismissRevealed,
  onRevoke,
  compact = false,
}: ApiKeysListProps) {
  const [confirming, setConfirming] = useState<ApiKeySummary | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {revealed !== null ? (
        <div className="rounded-[12px] bg-surface-2 p-4 shadow-border">
          <p className="flex items-center gap-2 text-sm font-medium">
            <TriangleAlert className="size-4 text-danger" strokeWidth={2} />
            Copy your new secret key now
          </p>
          <p className="mt-0.5 text-[13px] text-fg-2">
            This is the only time it is shown. Pockey stores only its hash and its first 12
            characters, so it cannot be displayed again. Lose it and you create a new key.
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

      {error !== null ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      {keys.length === 0 ? (
        <EmptyState
          icon={<KeyRound strokeWidth={1.5} />}
          title="No API keys"
          description="Create a key to call the API from your server."
        />
      ) : (
        <ul className="divide-y divide-border">
          {keys.map((key) => {
            const revoked = key.revokedAt !== null;
            return (
              <li
                key={key.id}
                className={cn(
                  'flex items-center justify-between gap-4',
                  compact ? 'py-3' : 'py-4',
                  revoked && 'opacity-60',
                )}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    <span className="truncate">{key.name ?? 'Untitled key'}</span>
                    {revoked ? <Badge>Revoked</Badge> : null}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-fg-2">
                    <span className="tabular-nums">{key.prefix}...</span>
                    <span>Created {formatDate(key.createdAt)}</span>
                    <span className="num">Last used {formatRelative(key.lastUsedAt)}</span>
                  </p>
                </div>
                {revoked ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:text-danger"
                    disabled={pending}
                    onClick={() => {
                      setConfirming(key);
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Revoke this key?"
        description="Every request signed with it starts failing immediately. This cannot be undone."
      >
        <div className="flex flex-col gap-5">
          {confirming ? (
            <div className="rounded-[10px] bg-surface-2 px-3 py-2 text-[13px] tabular-nums shadow-border">
              {confirming.name ?? 'Untitled key'} ({confirming.prefix}...)
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setConfirming(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                const target = confirming;
                if (!target) return;
                void onRevoke(target.id).then((ok) => {
                  if (ok) setConfirming(null);
                });
              }}
            >
              {pending ? 'Revoking' : 'Revoke key'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
