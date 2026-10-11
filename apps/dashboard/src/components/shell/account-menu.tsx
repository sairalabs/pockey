'use client';

import type { Developer } from '@pockey/types';
import { Check, Copy, LogOut, UserCog } from '../ui/icons';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { signOut } from '@/lib/api';

export interface AccountMenuProps {
  developer: Developer;
  onManageAccount: () => void;
}

export function AccountMenu({ developer, onManageAccount }: AccountMenuProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const leave = async () => {
    // A failed sign out still sends the developer to the login screen: the next
    // request re-reads the session and shows the truth.
    await signOut().catch(() => undefined);
    router.replace('/login');
    router.refresh();
  };

  return (
    <Menu
      className="min-w-56"
      trigger={
        <IconButton aria-label="Account" className="ms-1">
          <Avatar seed={developer.email} size={28} />
        </IconButton>
      }
    >
      <MenuItem
        closeOnClick={false}
        icon={copied ? <Check /> : <Copy />}
        onClick={() => {
          void navigator.clipboard.writeText(developer.email).then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1500);
          });
        }}
      >
        <span className="block truncate text-[13px] num">
          {copied ? 'Copied' : developer.email}
        </span>
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<UserCog />} onClick={onManageAccount}>
        Manage account
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
