'use client';

import type { AdminApp, Developer } from '@pockey/types';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { AccountInformationPane } from './account-information-pane';
import { ApiKeysPane } from './api-keys-pane';
import { AppInformationPane } from './app-information-pane';
import { AppearancePane } from './appearance-pane';
import { ConfigurationPane } from './configuration-pane';
import { MembersPane } from './members-pane';
import { NotificationsPane } from './notifications-pane';
import { settingsGroups, type SettingsSectionId } from './sections';
import { SponsoringPane } from './sponsoring-pane';

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  developer: Developer;
  /** Null while the developer has no app: the App group is then hidden. */
  app: AdminApp | null;
}

/*
  Concentric radii: dialog 24px, sidebar padding 12px, so nav items are 12px.
*/
export function SettingsDialog({
  open,
  onOpenChange,
  section,
  onSectionChange,
  developer,
  app,
}: SettingsDialogProps) {
  const groups = app ? settingsGroups : settingsGroups.filter((group) => group.label !== 'App');
  const current = groups.some((group) => group.items.some((item) => item.id === section))
    ? section
    : 'account-information';

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Settings" titleHidden size="settings">
      <nav
        aria-label="Settings sections"
        className="flex w-[268px] shrink-0 flex-col overflow-y-auto bg-surface-2 p-3"
      >
        {groups.map((group) => (
          <div key={group.label} className="mb-2">
            <p className="px-3 pb-1.5 pt-4 text-[12px] font-medium text-fg-3">{group.label}</p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const selected = item.id === current;
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={selected ? 'page' : undefined}
                      onClick={() => {
                        onSectionChange(item.id);
                      }}
                      className={cn(
                        'flex h-11 w-full items-center gap-3 rounded-[12px] px-3 text-left text-[15px] font-medium leading-none',
                        'transition-[background-color,color] duration-150 ease-out',
                        selected
                          ? 'bg-surface-3 text-fg'
                          : 'text-fg-2 hover:bg-surface-2 hover:text-fg',
                      )}
                    >
                      <Icon className="size-[18px] shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {app && current === 'app-information' ? (
        <AppInformationPane key={app.app.id} app={app} />
      ) : null}
      {app && current === 'configuration' ? <ConfigurationPane key={app.app.id} app={app} /> : null}
      {app && current === 'members' ? <MembersPane developer={developer} /> : null}
      {app && current === 'api-keys' ? <ApiKeysPane key={app.app.id} appId={app.app.id} /> : null}
      {app && current === 'sponsoring' ? <SponsoringPane key={app.app.id} app={app} /> : null}
      {current === 'account-information' ? <AccountInformationPane developer={developer} /> : null}
      {current === 'notifications' ? <NotificationsPane /> : null}
      {current === 'appearance' ? <AppearancePane /> : null}
    </Dialog>
  );
}
