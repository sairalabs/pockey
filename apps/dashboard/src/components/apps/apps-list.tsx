'use client';

import type { AdminApp } from '@pockey/types';
import { LayoutGrid, Plus } from '../ui/icons';
import Link from 'next/link';
import { useState } from 'react';
import { NewAppDialog } from '@/components/shell/new-app-dialog';
import { PageHeader } from '@/components/shell/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatInt } from '@/lib/format';

export function AppsList({ apps }: { apps: readonly AdminApp[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="stagger flex flex-col gap-6">
      <PageHeader
        title="Apps"
        description="Each app has its own users, keys and configuration."
        actions={
          <Button
            variant="primary"
            iconStart={<Plus />}
            onClick={() => {
              setOpen(true);
            }}
          >
            New app
          </Button>
        }
      />

      {apps.length === 0 ? (
        <Card flush>
          <EmptyState
            icon={<LayoutGrid />}
            title="No app yet"
            description="An app holds your login methods, chains, keys and end users."
            action={
              <Button
                variant="primary"
                iconStart={<Plus />}
                onClick={() => {
                  setOpen(true);
                }}
              >
                Create your first app
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {apps.map((entry) => (
            <Link
              key={entry.app.id}
              href={`/apps/${entry.app.id}`}
              className="flex flex-col gap-4 rounded-card bg-surface p-5 outline-offset-2 transition-[background-color] duration-150 ease-out hover:bg-surface-2"
            >
              <span className="flex items-center gap-3">
                <Avatar seed={entry.app.id} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{entry.app.name}</span>
                  <span className="block truncate text-[13px] text-fg-2 num">
                    {formatInt(entry.endUserCount)} {entry.endUserCount === 1 ? 'user' : 'users'},{' '}
                    {formatInt(entry.apiKeyCount)} active {entry.apiKeyCount === 1 ? 'key' : 'keys'}
                  </span>
                </span>
              </span>

              <span className="flex items-end justify-between">
                <span className="text-[13px] text-fg-2">Active wallets this month</span>
                <span className="text-xl font-medium leading-none num">
                  {formatInt(entry.usage.activeUsers)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <NewAppDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
