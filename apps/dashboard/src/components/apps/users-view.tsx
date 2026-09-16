'use client';

import { Search, Users } from 'lucide-react';
import { useId, useState } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import { formatInt, formatRelative, truncateMiddle } from '@/lib/format';
import type { EndUserRow } from '@/lib/mock-data';

const methodLabel: Record<EndUserRow['identity']['type'], string> = {
  email: 'Email',
  google: 'Google',
  apple: 'Apple',
  passkey: 'Passkey',
  wallet: 'Wallet',
};

export function UsersView({ users }: { users: readonly EndUserRow[] }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? users.filter(
        (user) =>
          user.identity.identifier.toLowerCase().includes(needle) ||
          user.wallets.some((wallet) => wallet.address.toLowerCase().includes(needle)),
      )
    : users;
  const activeSessions = users.reduce((sum, user) => sum + user.activeSessions, 0);

  return (
    <div className="stagger flex flex-col gap-6">
      <PageHeader
        title="Users"
        badge={<Badge>{formatInt(users.length)}</Badge>}
        description={`${formatInt(activeSessions)} active sessions right now.`}
      />

      <div className="relative">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search users
        </label>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3"
          strokeWidth={1.5}
        />
        <Input
          id={`${id}-search`}
          type="search"
          placeholder="Search by email, subject or address"
          value={query}
          className="ps-9"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </div>

      <Card flush>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Users strokeWidth={1.5} />}
            title="No users match"
            description="Try a different email or wallet address."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Wallets</Th>
                <Th className="text-right">Sessions</Th>
                <Th className="text-right">Last active</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id}>
                  <Td>
                    <span className="flex items-center gap-3">
                      <Avatar seed={user.id} size={28} />
                      <span className="min-w-0">
                        <span className="block max-w-56 truncate font-medium">
                          {user.identity.identifier}
                        </span>
                        <span className="block text-[12px] text-fg-3">
                          {methodLabel[user.identity.type]}
                        </span>
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1.5">
                      {user.wallets.map((wallet) => (
                        <span
                          key={wallet.id}
                          className="inline-flex h-6 items-center gap-1.5 rounded-pill bg-surface-2 ps-2 pe-2.5 font-mono text-[12px] text-fg-2 shadow-border"
                        >
                          <span
                            aria-hidden="true"
                            className={
                              wallet.chainFamily === 'evm'
                                ? 'size-1.5 rounded-full bg-[#7ea3ff]'
                                : 'size-1.5 rounded-full bg-[#9ef0c9]'
                            }
                          />
                          <span className="sr-only">
                            {wallet.chainFamily === 'evm' ? 'EVM' : 'Solana'}
                          </span>
                          {truncateMiddle(wallet.address, 6, 4)}
                        </span>
                      ))}
                    </span>
                  </Td>
                  <Td className="text-right num">{formatInt(user.activeSessions)}</Td>
                  <Td className="text-right text-fg-2 num">{formatRelative(user.lastActiveAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
