'use client';

import { CreateAppInput, type AdminApp } from '@pockey/types';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { ApiError, createApp, errorMessage } from '@/lib/api';

export interface NewAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the created app, before the dashboard navigates to it. */
  onCreated?: (app: AdminApp) => void;
}

export function NewAppDialog({ open, onOpenChange, onCreated }: NewAppDialogProps) {
  const id = useId();
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [origins, setOrigins] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reset = () => {
    setName('');
    setSlug('');
    setOrigins('');
    setError(null);
    setSlugError(null);
  };

  const submit = async () => {
    const allowedOrigins = origins
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const trimmedSlug = slug.trim();
    const parsed = CreateAppInput.safeParse({
      name: name.trim(),
      allowedOrigins,
      ...(trimmedSlug.length > 0 ? { slug: trimmedSlug } : {}),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue ? issue.path.join('.') : '';
      if (path === 'slug') setSlugError(issue?.message ?? 'Invalid slug');
      else if (issue) setError(`${path === '' ? 'input' : path}: ${issue.message}`);
      else setError('Invalid input');
      return;
    }

    setPending(true);
    setError(null);
    setSlugError(null);
    try {
      const created = await createApp(parsed.data);
      reset();
      onOpenChange(false);
      onCreated?.(created);
      router.push(`/apps/${created.app.id}`);
      router.refresh();
    } catch (cause) {
      // A slug already used by another app of this developer is a 409, and it
      // is the one error that belongs next to the field.
      if (cause instanceof ApiError && cause.code === 'conflict') setSlugError(cause.message);
      else setError(errorMessage(cause, 'Could not create the app'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="New app"
      description="Each app gets its own public id, secret keys and end users."
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Name" htmlFor={`${id}-name`} counter={{ value: name.length, max: 60 }}>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="My app"
            autoFocus
            maxLength={60}
          />
        </Field>
        <Field
          label="Slug"
          htmlFor={`${id}-slug`}
          hint="Optional. Lowercase letters, digits and hyphens. Derived from the name when empty."
        >
          <Input
            id={`${id}-slug`}
            value={slug}
            spellCheck={false}
            aria-invalid={slugError !== null || undefined}
            className={slugError === null ? 'num' : 'num shadow-[0_0_0_2px_var(--danger)]'}
            onChange={(event) => {
              setSlug(event.target.value);
              setSlugError(null);
            }}
            placeholder="my-app"
            maxLength={40}
          />
        </Field>
        {slugError !== null ? (
          <p role="alert" className="-mt-3 text-[13px] text-danger">
            {slugError}
          </p>
        ) : null}
        <Field
          label="Allowed origins"
          htmlFor={`${id}-origins`}
          hint="One origin per line, scheme and host only. Wildcards are refused."
        >
          <Textarea
            id={`${id}-origins`}
            value={origins}
            onChange={(event) => {
              setOrigins(event.target.value);
            }}
            placeholder={'https://app.example.com\nhttp://localhost:3000'}
            className="tabular-nums text-[13px]"
          />
        </Field>
        {error !== null ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={pending || name.trim().length === 0}>
            {pending ? 'Creating' : 'Create app'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
