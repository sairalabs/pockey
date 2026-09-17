'use client';

import { Check, Copy, LogOut, UserCog } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { truncateMiddle } from '@/lib/format';
import { developer } from '@/lib/mock-data';

export function AccountMenu({ onManageAccount }: { onManageAccount: () => void }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

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
        icon={copied ? <Check strokeWidth={1.5} /> : <Copy strokeWidth={1.5} />}
        onClick={() => {
          void navigator.clipboard.writeText(developer.address).then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1500);
          });
        }}
      >
        <span className="tabular-nums text-[13px]">
          {copied ? 'Copied' : truncateMiddle(developer.address, 6, 4)}
        </span>
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<UserCog strokeWidth={1.5} />} onClick={onManageAccount}>
        Manage account
      </MenuItem>
      <MenuItem
        icon={<LogOut strokeWidth={1.5} />}
        onClick={() => {
          // TODO(T5.1): call Better Auth sign out before redirecting.
          router.push('/login');
        }}
      >
        Log out
      </MenuItem>
    </Menu>
  );
}
