'use client';

import type { Developer } from '@pockey/types';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { signOut } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { KeyValue, Pane } from './pane';

/**
 * The developer as the API knows it. The admin API has no route to change or
 * delete a developer, so this pane reads and signs out, and says where the rest
 * has to happen instead of offering buttons that answer 404.
 */
export function AccountInformationPane({ developer }: { developer: Developer }) {
  const router = useRouter();

  const leave = async () => {
    await signOut().catch(() => undefined);
    router.replace('/login');
    router.refresh();
  };

  return (
    <Pane
      title="Account information"
      actions={
        <Button
          size="sm"
          onClick={() => {
            void leave();
          }}
        >
          Sign out
        </Button>
      }
    >
      <div className="">
        <KeyValue label="Name">{developer.name ?? 'Not set'}</KeyValue>
        <KeyValue label="Email">
          <span className="inline-flex items-center gap-1">
            <span className="text-[13px]">{developer.email}</span>
            <CopyButton value={developer.email} label="Copy email" />
          </span>
        </KeyValue>
        <KeyValue label="Developer id">
          <span className="inline-flex items-center gap-1">
            <span className="tabular-nums text-[13px]">{developer.id}</span>
            <CopyButton value={developer.id} label="Copy developer id" />
          </span>
        </KeyValue>
        <KeyValue label="Billing">
          <Badge tone={developer.billingReady ? 'accent' : 'neutral'}>
            {developer.billingReady ? 'Customer created' : 'No customer yet'}
          </Badge>
        </KeyValue>
        <KeyValue label="Member since">{formatDate(developer.createdAt)}</KeyValue>
      </div>

      <p className="mt-6 text-[13px] text-fg-3">
        Changing your email or closing your account is not self service yet. Write to support and we
        handle it by hand.
      </p>
    </Pane>
  );
}
