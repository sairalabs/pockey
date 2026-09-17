'use client';

import type { CreateAppInput } from '@pocketkey/types';
import { ArrowUpRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { NewAppDialog } from '@/components/shell/new-app-dialog';
import { PageHeader } from '@/components/shell/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { formatInt } from '@/lib/format';
import type { AppSummary } from '@/lib/mock-data';

interface PendingApp {
  key: string;
  name: string;
  origins: number;
}

export function AppsList({ initial }: { initial: readonly AppSummary[] }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<readonly PendingApp[]>([]);

  const onCreate = (input: CreateAppInput) => {
    // TODO(T5.1): the API returns the created app; until then it is listed as pending.
    setPending((current) => [
      ...current,
      {
        key: `${input.name}-${current.length}`,
        name: input.name,
        origins: input.allowedOrigins.length,
      },
    ]);
  };

  return (
    <div className="stagger flex flex-col gap-6">
      <PageHeader
        title="Apps"
        description="Each app has its own users, keys and configuration."
        actions={
          <Button
            variant="primary"
            iconStart={<Plus strokeWidth={2} />}
            onClick={() => {
              setOpen(true);
            }}
          >
            New app
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {initial.map((entry) => (
          <Card key={entry.app.id} className="flex flex-col gap-4">
            <Link
              href={`/apps/${entry.app.id}`}
              className="group flex items-center gap-3 rounded-[8px] outline-offset-4"
            >
              <Avatar
                seed={entry.app.id}
                size={40}
                shape="square"
                initial={entry.app.name.charAt(0)}
                className="rounded-[10px]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-medium">
                  <span className="truncate">{entry.app.name}</span>
                  <ArrowUpRight
                    className="size-4 text-fg-3 transition-[color] duration-150 ease-out group-hover:text-fg"
                    strokeWidth={2}
                  />
                </span>
                <span className="block truncate text-[13px] text-fg-2">{entry.tagline}</span>
              </span>
            </Link>

            <div className="flex items-center gap-1 rounded-[10px] bg-surface-2 ps-3 pe-1 py-1">
              <span className="min-w-0 flex-1 truncate tabular-nums text-[12px] text-fg-2">
                {entry.app.publicId}
              </span>
              <CopyButton value={entry.app.publicId} label="Copy public app id" />
            </div>

            <div className="flex items-end justify-between">
              <span className="text-[13px] text-fg-2">MAW this month</span>
              <span className="text-xl font-medium leading-none num">
                {formatInt(entry.mawThisMonth)}
              </span>
            </div>
          </Card>
        ))}

        {pending.map((entry) => (
          <Card key={entry.key} className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Avatar
                seed={entry.key}
                size={40}
                shape="square"
                initial={entry.name.charAt(0)}
                className="rounded-[10px]"
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{entry.name}</span>
                  <Badge>Pending</Badge>
                </p>
                <p className="text-[13px] text-fg-2 num">
                  {entry.origins} allowed {entry.origins === 1 ? 'origin' : 'origins'}
                </p>
              </div>
            </div>
            <p className="text-[13px] text-fg-3">
              The public id is assigned once the app is saved.
            </p>
          </Card>
        ))}
      </div>

      <NewAppDialog open={open} onOpenChange={setOpen} onCreate={onCreate} />
    </div>
  );
}
