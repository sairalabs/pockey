'use client';

import type { Developer } from '@pockey/types';
import { LogOut, Settings } from '../ui/icons';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/avatar';
import { Menu, MenuItem } from '@/components/ui/menu';
import { signOut } from '@/lib/api';

export interface AccountMenuProps {
  developer: Developer;
  onOpenSettings: () => void;
}

/** Avatar and email in the bar, two things in the menu: settings and the way out. */
export function AccountMenu({ developer, onOpenSettings }: AccountMenuProps) {
  const router = useRouter();

  const leave = async () => {
    // A failed sign out still sends the developer to the login screen: the next
    // request re-reads the session and shows the truth.
    await signOut().catch(() => undefined);
    router.replace('/login');
    router.refresh();
  };

  return (
    <Menu
      className="min-w-48"
      trigger={
        <button
          type="button"
          aria-label="Account"
          className="ms-1 flex items-center gap-2 rounded-pill py-1 pe-3 ps-1 text-[13px] text-fg-2 transition-[background-color,color] duration-150 ease-out hover:bg-surface-2 hover:text-fg"
        >
          <Avatar seed={developer.email} size={28} />
          <span className="max-w-48 truncate num">{developer.email}</span>
        </button>
      }
    >
      <MenuItem icon={<Settings />} onClick={onOpenSettings}>
        Settings
      </MenuItem>
      <MenuItem
        icon={<LogOut />}
        onClick={() => {
          void leave();
        }}
      >
        Log out
      </MenuItem>
    </Menu>
  );
}
