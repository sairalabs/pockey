'use client';

import { Inbox, Settings } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { AccountMenu } from '@/components/shell/account-menu';
import { AppSwitcher } from '@/components/shell/app-switcher';
import { NewAppDialog } from '@/components/shell/new-app-dialog';
import { NotificationsPopover } from '@/components/shell/notifications-popover';
import { SettingsDialog } from '@/components/shell/settings/settings-dialog';
import type { SettingsSectionId } from '@/components/shell/settings/sections';
import { IconButton } from '@/components/ui/icon-button';
import { apps, findApp, type AppSummary } from '@/lib/mock-data';

function useCurrentApp(): AppSummary {
  const pathname = usePathname();
  const match = /^\/apps\/([^/]+)/.exec(pathname);
  const fromPath = match?.[1] ? findApp(match[1]) : undefined;
  const fallback = apps[0];
  if (!fallback) throw new Error('Mock data needs at least one app');
  return fromPath ?? fallback;
}

export function TopBar() {
  const current = useCurrentApp();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [section, setSection] = useState<SettingsSectionId>('app-information');
  const [newAppOpen, setNewAppOpen] = useState(false);

  const openSettings = (target: SettingsSectionId) => {
    setSection(target);
    setSettingsOpen(true);
  };

  return (
    <header className="flex h-14 items-center justify-between px-6">
      <AppSwitcher
        current={current}
        onCreateApp={() => {
          setNewAppOpen(true);
        }}
      />

      <div className="flex items-center gap-1">
        <NotificationsPopover
          trigger={
            <IconButton aria-label="Notifications">
              <Inbox strokeWidth={1.5} />
            </IconButton>
          }
        />
        <IconButton
          aria-label="Settings"
          onClick={() => {
            openSettings('app-information');
          }}
        >
          <Settings strokeWidth={1.5} />
        </IconButton>
        <AccountMenu
          onManageAccount={() => {
            openSettings('account-information');
          }}
        />
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        section={section}
        onSectionChange={setSection}
        app={current}
      />
      <NewAppDialog open={newAppOpen} onOpenChange={setNewAppOpen} />
    </header>
  );
}
