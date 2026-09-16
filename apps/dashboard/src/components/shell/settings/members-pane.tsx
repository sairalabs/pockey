'use client';

import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { members as seed, type Member } from '@/lib/mock-data';
import { Pane } from './pane';

const roleLabel: Record<Member['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  viewer: 'Viewer',
};

export function MembersPane() {
  const id = useId();
  const [members, setMembers] = useState<readonly Member[]>(seed);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');

  const invite = () => {
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return;
    // TODO(T5.1): POST /admin/apps/:id/members and send the invite email.
    setMembers((current) => [
      ...current,
      { email: value, role: 'viewer', joinedAt: new Date().toISOString() },
    ]);
    setEmail('');
    setAdding(false);
  };

  return (
    <Pane
      title="Members"
      badge={<Badge>{members.length}</Badge>}
      actions={
        <Button
          size="sm"
          iconStart={<Plus strokeWidth={2} />}
          aria-expanded={adding}
          onClick={() => {
            setAdding((value) => !value);
          }}
        >
          Add
        </Button>
      }
    >
      {adding ? (
        <form
          className="mb-4 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            invite();
          }}
        >
          <label htmlFor={`${id}-email`} className="sr-only">
            Email to invite
          </label>
          <Input
            id={`${id}-email`}
            type="email"
            autoFocus
            placeholder="teammate@company.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          <Button variant="primary" type="submit" static>
            Invite
          </Button>
        </form>
      ) : null}

      <ul className="divide-y divide-border">
        {members.map((member) => (
          <li key={member.email} className="flex items-center justify-between gap-4 py-3.5">
            <span className="flex min-w-0 items-center gap-3">
              <Avatar seed={member.email} size={32} />
              <span className="truncate text-sm">
                {member.email === seed[0]?.email ? (
                  <>
                    <span className="font-medium">you</span>
                    <span className="text-fg-2">@{member.email.split('@')[1]}</span>
                  </>
                ) : (
                  member.email
                )}
              </span>
            </span>
            <Badge>{roleLabel[member.role]}</Badge>
          </li>
        ))}
      </ul>
    </Pane>
  );
}
