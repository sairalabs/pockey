'use client';

import type { AdminApp, Developer } from '@pockey/types';
import { Inbox } from '../ui/icons';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { AccountMenu } from '@/components/shell/account-menu';
import { AppSwitcher } from '@/components/shell/app-switcher';
import { NewAppDialog } from '@/components/shell/new-app-dialog';
import { NotificationsPopover } from '@/components/shell/notifications-popover';
import { SettingsDialog } from '@/components/shell/settings/settings-dialog';
import type { SettingsSectionId } from '@/components/shell/settings/sections';
import { IconButton } from '@/components/ui/icon-button';

export interface TopBarProps {
  developer: Developer;
  apps: readonly AdminApp[];
}

/** The app in the URL, or the first one. Null while the developer has none. */
function useCurrentApp(apps: readonly AdminApp[]): AdminApp | null {
  const pathname = usePathname();
  const match = /^\/apps\/([^/]+)/.exec(pathname);
  const id = match?.[1];
  return apps.find((entry) => entry.app.id === id) ?? apps[0] ?? null;
}

export function TopBar({ developer, apps }: TopBarProps) {
  const current = useCurrentApp(apps);
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
        apps={apps}
        current={current}
        onCreateApp={() => {
          setNewAppOpen(true);
        }}
      />

      <div className="flex items-center gap-1">
        <NotificationsPopover
          trigger={
            <IconButton aria-label="Notifications">
              <Inbox />
            </IconButton>
          }
        />
        <AccountMenu
          developer={developer}
          onOpenSettings={() => {
            openSettings(current ? 'app-information' : 'account-information');
          }}
        />
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        section={section}
        onSectionChange={setSection}
        developer={developer}
        app={current}
      />
      <NewAppDialog open={newAppOpen} onOpenChange={setNewAppOpen} />
    </header>
  );
}
