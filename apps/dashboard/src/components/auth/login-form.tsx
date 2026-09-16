'use client';

import { ArrowRight } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';

export function LoginForm() {
  const id = useId();
  const [email, setEmail] = useState('');

  return (
    <div className="stagger w-full max-w-[400px]">
      <div className="mb-6 text-center">
        <p className="text-sm font-semibold tracking-tight">Pocketkey</p>
        <h1 className="mt-3 text-[28px] font-medium leading-tight tracking-[-0.02em]">Sign in</h1>
        <p className="mt-1 text-sm text-fg-2">Developer dashboard for your embedded wallets.</p>
      </div>

      <Card className="p-6">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            // TODO(T5.1): Better Auth email OTP.
            event.preventDefault();
          }}
        >
          <Field label="Email" htmlFor={`${id}-email`}>
            <Input
              id={`${id}-email`}
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </Field>
          <Button
            variant="primary"
            type="submit"
            iconEnd={<ArrowRight strokeWidth={2} />}
            disabled={email.trim().length === 0}
          >
            Continue with email
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-[12px] text-fg-3">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button
          className="w-full"
          onClick={() => {
            // TODO(T5.1): Better Auth GitHub OAuth redirect.
          }}
        >
          Continue with GitHub
        </Button>
      </Card>

      <p className="mt-6 text-center text-[12px] text-fg-3">
        By continuing you agree to the Terms and the Privacy policy.
      </p>
    </div>
  );
}
