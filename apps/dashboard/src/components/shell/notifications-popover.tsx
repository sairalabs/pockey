'use client';

import { Inbox } from '../ui/icons';
import type { ReactElement } from 'react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Popover } from '@/components/ui/popover';
import { Tab, TabPanel, Tabs, TabsList } from '@/components/ui/tabs';

export interface Notification {
  id: string;
  title: string;
  body: string;
  completed: boolean;
}

/**
 * The admin API exposes no notification feed, so the list stays empty and the
 * popover shows the "all caught up" state it was designed around.
 */
const notifications: readonly Notification[] = [];

export function NotificationsPopover({
  trigger,
}: {
  trigger: ReactElement<Record<string, unknown>>;
}) {
  const unread = notifications.filter((n) => !n.completed);
  const completed = notifications.filter((n) => n.completed);

  return (
    <Popover trigger={trigger} className="w-[360px]">
      <Tabs defaultValue="unread">
        <TabsList className="px-4">
          <Tab value="unread">
            Unread
            <Badge className="h-5 px-1.5">{unread.length}</Badge>
          </Tab>
          <Tab value="completed">Completed</Tab>
        </TabsList>
        <TabPanel value="unread">
          {unread.length === 0 ? (
            <EmptyState
              icon={<Inbox />}
              title="You're all caught up."
              description="New notifications will show up here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {unread.map((n) => (
                <li key={n.id} className="px-4 py-3">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-[13px] text-fg-2">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </TabPanel>
        <TabPanel value="completed">
          {completed.length === 0 ? (
            <EmptyState
              icon={<Inbox />}
              title="Nothing completed yet."
              description="Notifications you mark as done land here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {completed.map((n) => (
                <li key={n.id} className="px-4 py-3">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-[13px] text-fg-2">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </TabPanel>
      </Tabs>
    </Popover>
  );
}
