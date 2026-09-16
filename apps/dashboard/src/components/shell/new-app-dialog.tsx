'use client';

import { CreateAppInput } from '@pocketkey/types';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';

export interface NewAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the validated input. Client state only for now. */
  onCreate?: (input: CreateAppInput) => void;
}

export function NewAppDialog({ open, onOpenChange, onCreate }: NewAppDialogProps) {
  const id = useId();
  const [name, setName] = useState('');
  const [origins, setOrigins] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setOrigins('');
    setError(null);
  };

  const submit = () => {
    const allowedOrigins = origins
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const parsed = CreateAppInput.safeParse({ name: name.trim(), allowedOrigins });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue ? `${issue.path.join('.') || 'input'}: ${issue.message}` : 'Invalid input');
      return;
    }
    // TODO(T5.1): POST /admin/apps and navigate to the created app.
    onCreate?.(parsed.data);
    reset();
    onOpenChange(false);
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
          submit();
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
            className="font-mono text-[13px]"
          />
        </Field>
        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={name.trim().length === 0}>
            Create app
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
