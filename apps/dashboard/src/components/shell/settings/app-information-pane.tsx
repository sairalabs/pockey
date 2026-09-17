'use client';

import { AllowedOrigin, AppSlug, type AdminApp } from '@pocketkey/types';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { ApiError, errorMessage, updateApp } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { KeyValue, Pane, SavedHint } from './pane';

const NAME_MAX = 60;

/**
 * Identity of the app as the API stores it: name, slug and allowed origins.
 * Everything else the login modal shows lives in Configuration.
 */
export function AppInformationPane({ app }: { app: AdminApp }) {
  const id = useId();
  const router = useRouter();
  const [name, setName] = useState(app.app.name);
  const [slug, setSlug] = useState(app.app.slug);
  const [origins, setOrigins] = useState(app.app.allowedOrigins.join('\n'));
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length > 0 && name.length <= NAME_MAX;

  const save = async () => {
    const parsedSlug = AppSlug.safeParse(slug.trim());
    if (!parsedSlug.success) {
      setError(parsedSlug.error.issues[0]?.message ?? 'Invalid slug');
      return;
    }
    const lines = origins
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const parsedOrigins: string[] = [];
    for (const line of lines) {
      const parsed = AllowedOrigin.safeParse(line);
      if (!parsed.success) {
        setError(`${line}: ${parsed.error.issues[0]?.message ?? 'invalid origin'}`);
        return;
      }
      parsedOrigins.push(parsed.data);
    }

    setPending(true);
    setError(null);
    try {
      await updateApp(app.app.id, {
        name: name.trim(),
        slug: parsedSlug.data,
        allowedOrigins: parsedOrigins,
      });
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 1500);
      router.refresh();
    } catch (cause) {
      // A slug taken by another app of this developer comes back as a 409.
      setError(
        cause instanceof ApiError && cause.code === 'conflict'
          ? cause.message
          : errorMessage(cause, 'Could not save the app'),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Pane
      title="App information"
      actions={
        <>
          <SavedHint visible={saved} />
          <Button
            variant="primary"
            size="sm"
            disabled={!valid || pending}
            onClick={() => {
              void save();
            }}
          >
            {pending ? 'Saving' : 'Save'}
          </Button>
        </>
      }
    >
      {error !== null ? (
        <p
          role="alert"
          className="mb-4 rounded-[10px] bg-danger/10 px-3 py-2 text-[13px] text-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-5">
          <Avatar seed={app.app.id} size={80} shape="square" initial={name.charAt(0) || '?'} />
          <div>
            <p className="text-sm font-medium">App icon</p>
            <p className="mt-0.5 text-[13px] text-fg-2">
              Generated from the app id. Set a logo URL in Configuration to show your own mark in
              the login modal.
            </p>
          </div>
        </div>

        <Field label="Name" htmlFor={`${id}-name`} counter={{ value: name.length, max: NAME_MAX }}>
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={NAME_MAX}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>

        <Field
          label="Slug"
          htmlFor={`${id}-slug`}
          hint="Lowercase letters, digits and hyphens. Unique across your apps."
        >
          <Input
            id={`${id}-slug`}
            value={slug}
            maxLength={40}
            spellCheck={false}
            className="num"
            onChange={(event) => {
              setSlug(event.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field
          label="Allowed origins"
          htmlFor={`${id}-origins`}
          hint="One origin per line, scheme and host only. Wildcards are refused."
        >
          <Textarea
            id={`${id}-origins`}
            value={origins}
            className="tabular-nums text-[13px]"
            placeholder={'https://app.example.com\nhttp://localhost:3000'}
            onChange={(event) => {
              setOrigins(event.target.value);
              setError(null);
            }}
          />
        </Field>

        <div className="divide-y divide-border">
          <KeyValue label="Public app id">
            <span className="inline-flex items-center gap-1">
              <span className="tabular-nums text-[13px]">{app.app.publicId}</span>
              <CopyButton value={app.app.publicId} label="Copy public app id" />
            </span>
          </KeyValue>
          <KeyValue label="Created">{formatDate(app.app.createdAt)}</KeyValue>
        </div>
      </div>
    </Pane>
  );
}
