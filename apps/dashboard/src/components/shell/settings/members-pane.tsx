'use client';

import type { Developer } from '@pocketkey/types';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';
import { Pane } from './pane';

/**
 * One app belongs to one developer at MVP: the API has no member table and no
 * invite endpoint, so this pane shows the owner and says what is missing rather
 * than offering an invite that would go nowhere.
 */
export function MembersPane({ developer }: { developer: Developer }) {
  return (
    <Pane title="Members" badge={<Badge>1</Badge>}>
      <p className="mb-4 text-[13px] text-fg-2">
        Teams are not part of the MVP. An app belongs to the developer who created it.
      </p>
      <ul className="divide-y divide-border">
        <li className="flex items-center justify-between gap-4 py-3.5">
          <span className="flex min-w-0 items-center gap-3">
            <Avatar seed={developer.email} size={32} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {developer.name ?? developer.email}
              </span>
              <span className="block truncate text-[13px] text-fg-2">{developer.email}</span>
            </span>
          </span>
          <Badge>Owner</Badge>
        </li>
      </ul>
      <p className="mt-4 text-[13px] text-fg-3">Member since {formatDate(developer.createdAt)}.</p>
    </Pane>
  );
}
