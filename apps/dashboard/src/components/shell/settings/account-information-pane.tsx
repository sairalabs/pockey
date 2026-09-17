'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Field, Input } from '@/components/ui/input';
import { formatDate, truncateMiddle } from '@/lib/format';
import { developer } from '@/lib/mock-data';
import { KeyValue, Pane, SavedHint } from './pane';

export function AccountInformationPane() {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(developer.name);
  const [email, setEmail] = useState(developer.email);
  const [saved, setSaved] = useState(false);

  return (
    <Pane
      title="Account information"
      actions={
        <>
          <SavedHint visible={saved} />
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (editing) {
                // TODO(T5.1): PATCH /admin/me.
                setSaved(true);
                setTimeout(() => {
                  setSaved(false);
                }, 1500);
              }
              setEditing((value) => !value);
            }}
          >
            {editing ? 'Save' : 'Update'}
          </Button>
        </>
      }
    >
      {editing ? (
        <div className="flex flex-col gap-5 pb-4">
          <Field label="Name" htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
          <Field
            label="Email"
            htmlFor={`${id}-email`}
            hint="A verification code is sent to the new address."
          >
            <Input
              id={`${id}-email`}
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </Field>
        </div>
      ) : (
        <div className="divide-y divide-border">
          <KeyValue label="Name">{name}</KeyValue>
          <KeyValue label="Email">{email}</KeyValue>
          <KeyValue label="Wallet">
            <span className="inline-flex items-center gap-1">
              <span className="tabular-nums text-[13px]">
                {truncateMiddle(developer.address, 6, 4)}
              </span>
              <CopyButton value={developer.address} label="Copy address" />
            </span>
          </KeyValue>
          <KeyValue label="Member since">{formatDate(developer.createdAt)}</KeyValue>
        </div>
      )}

      <div className="mt-8 flex items-center gap-3">
        <span className="text-[13px] font-medium text-danger">Danger zone</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="mt-4 flex items-center justify-between gap-6">
        <div>
          <p className="text-sm font-medium">Delete account</p>
          <p className="mt-0.5 text-[13px] text-fg-2">
            Removes every app, key and end user. This cannot be undone.
          </p>
        </div>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            // TODO(T5.1): confirmation dialog then DELETE /admin/me.
          }}
        >
          Delete account
        </Button>
      </div>
    </Pane>
  );
}
