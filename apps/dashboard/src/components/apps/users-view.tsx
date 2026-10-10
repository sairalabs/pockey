'use client';

import type { AdminEndUserList, EndUser, Identity, IdentityType } from '@pockey/types';
import { Search, Users } from 'lucide-react';
import { useId, useState } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage, listEndUsers } from '@/lib/api';
import { formatDate, formatInt, formatRelative, truncateMiddle } from '@/lib/format';

const methodLabel: Record<IdentityType, string> = {
  email: 'Email',
  google: 'Google',
  apple: 'Apple',
  passkey: 'Passkey',
  wallet: 'Wallet',
};

/** An email reads better than an OAuth subject, so it wins when both exist. */
function primaryIdentity(user: EndUser): Identity | null {
  return (
    user.identities.find((identity) => identity.type === 'email') ?? user.identities[0] ?? null
  );
}

export interface UsersViewProps {
  appId: string;
  initial: AdminEndUserList;
}

export function UsersView({ appId, initial }: UsersViewProps) {
  const id = useId();
  const [users, setUsers] = useState<readonly EndUser[]>(initial.users);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? users.filter(
        (user) =>
          user.identities.some((identity) => identity.identifier.toLowerCase().includes(needle)) ||
          user.wallets.some((wallet) => wallet.address.toLowerCase().includes(needle)),
      )
    : users;

  const loadMore = async () => {
    if (cursor === null) return;
    setPending(true);
    setError(null);
    try {
      const page = await listEndUsers(appId, { cursor });
      setUsers((current) => [...current, ...page.users]);
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(errorMessage(cause, 'Could not load more users'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="stagger flex flex-col gap-6">
      <PageHeader
        title="Users"
        badge={<Badge>{formatInt(initial.total)}</Badge>}
        description={`${formatInt(users.length)} loaded of ${formatInt(initial.total)}, newest first.`}
      />

      <div className="relative">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search loaded users
        </label>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3"
          strokeWidth={1.5}
        />
        <Input
          id={`${id}-search`}
          type="search"
          placeholder="Filter loaded users by email, subject or address"
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
            title={users.length === 0 ? 'No users yet' : 'No user matches'}
            description={
              users.length === 0
                ? 'They appear here the first time someone signs in through your app.'
                : 'Try a different email or wallet address, or load more users.'
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Wallets</Th>
                <Th className="text-right">Created</Th>
                <Th className="text-right">Last active</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const identity = primaryIdentity(user);
                return (
                  <tr key={user.id}>
                    <Td>
                      <span className="flex items-center gap-3">
                        <Avatar seed={user.id} size={28} />
                        <span className="min-w-0">
                          <span className="block max-w-56 truncate font-medium">
                            {identity?.identifier ?? user.id}
                          </span>
                          <span className="block text-[12px] text-fg-3">
                            {identity ? methodLabel[identity.type] : 'No identity'}
                          </span>
                        </span>
                      </span>
                    </Td>
                    <Td>
                      {user.wallets.length === 0 ? (
                        <span className="text-[13px] text-fg-3">None</span>
                      ) : (
                        <span className="flex flex-wrap gap-1.5">
                          {user.wallets.map((wallet) => (
                            <span
                              key={wallet.id}
                              className="inline-flex h-6 items-center gap-1.5 rounded-pill bg-surface-2 ps-2 pe-2.5 tabular-nums text-[12px] text-fg-2 shadow-border"
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
                      )}
                    </Td>
                    <Td className="text-right text-fg-2 num">{formatDate(user.createdAt)}</Td>
                    <Td className="text-right text-fg-2 num">
                      {formatRelative(user.lastActiveAt)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {error !== null ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      {cursor !== null ? (
        <div className="flex justify-center">
          <Button
            disabled={pending}
            onClick={() => {
              void loadMore();
            }}
          >
            {pending ? 'Loading' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
