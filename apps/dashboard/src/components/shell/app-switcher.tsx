'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/avatar';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';
import { apps, type AppSummary } from '@/lib/mock-data';

export interface AppSwitcherProps {
  current: AppSummary;
  onCreateApp: () => void;
}

/** 20px square app icon + name + up/down chevrons, opens the app list. */
export function AppSwitcher({ current, onCreateApp }: AppSwitcherProps) {
  const router = useRouter();

  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          aria-label={`Switch app, current: ${current.app.name}`}
          className="flex h-9 items-center gap-2 rounded-[10px] ps-1.5 pe-2 text-sm font-medium text-fg transition-[background-color,transform] duration-150 ease-out hover:bg-surface-2 active:scale-[0.96] data-popup-open:bg-surface-2"
        >
          <Avatar
            seed={current.app.id}
            size={20}
            shape="square"
            initial={current.app.name.charAt(0)}
          />
          <span className="max-w-40 truncate">{current.app.name}</span>
          <ChevronsUpDown className="size-4 text-fg-2" strokeWidth={2} />
        </button>
      }
    >
      <MenuLabel>Apps</MenuLabel>
      {apps.map((entry) => {
        const selected = entry.app.id === current.app.id;
        return (
          <MenuItem
            key={entry.app.id}
            icon={
              <Avatar
                seed={entry.app.id}
                size={20}
                shape="square"
                initial={entry.app.name.charAt(0)}
              />
            }
            onClick={() => {
              router.push(`/apps/${entry.app.id}`);
            }}
            className={selected ? 'text-fg' : ''}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="truncate">{entry.app.name}</span>
              {selected ? <Check className="size-4 text-fg-2" strokeWidth={1.5} /> : null}
            </span>
          </MenuItem>
        );
      })}
      <MenuSeparator />
      <MenuItem icon={<Plus strokeWidth={1.5} />} onClick={onCreateApp}>
        Create app
      </MenuItem>
    </Menu>
  );
}
