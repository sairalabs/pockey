'use client';

import { ArrowLeft, ArrowRight } from '../ui/icons';
import { Lockup } from '../ui/logo';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { OtpInput } from '@/components/auth/otp-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { errorMessage, sendLoginCode, startGithubSignIn, verifyLoginCode } from '@/lib/api';

export interface LoginFormProps {
  /** GitHub is offered only when the API holds both GitHub secrets. */
  githubEnabled: boolean;
  /** Where to land after a successful sign in. */
  next?: string;
}

const RESEND_SECONDS = 30;

export function LoginForm({ githubEnabled, next = '/apps' }: LoginFormProps) {
  const id = useId();
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => {
      setCooldown((value) => value - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [cooldown]);

  const requestCode = async () => {
    setPending(true);
    setError(null);
    try {
      await sendLoginCode(email.trim());
      setStep('code');
      setCooldown(RESEND_SECONDS);
    } catch (cause) {
      setError(errorMessage(cause, 'Could not send the code'));
    } finally {
      setPending(false);
    }
  };

  const submitCode = async (code: string) => {
    setPending(true);
    setError(null);
    try {
      await verifyLoginCode(email.trim(), code);
      router.replace(next);
      // The shell and every page read the session on the server.
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, 'That code did not work'));
      setPending(false);
    }
  };

  const continueWithGithub = async () => {
    setPending(true);
    setError(null);
    try {
      const url = await startGithubSignIn(`${window.location.origin}${next}`);
      window.location.assign(url);
    } catch (cause) {
      setError(errorMessage(cause, 'GitHub sign in is unavailable'));
      setPending(false);
    }
  };

  return (
    <div className="stagger w-full max-w-[400px]">
      <div className="mb-6 text-center">
        <Lockup height={20} aria-label="Pockey" className="mx-auto" />
        <h1 className="mt-3 text-[28px] font-medium leading-tight tracking-[-0.02em]">
          {step === 'email' ? 'Sign in' : 'Check your email'}
        </h1>
        <p className="mt-1 text-sm text-fg-2">
          {step === 'email' ? (
            'Developer dashboard for your embedded wallets.'
          ) : (
            <>
              We sent a 6 digit code to <span className="text-fg">{email.trim()}</span>.
            </>
          )}
        </p>
      </div>

      <Card className="p-6">
        {step === 'email' ? (
          <>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void requestCode();
              }}
            >
              <Field label="Email" htmlFor={`${id}-email`}>
                <Input
                  id={`${id}-email`}
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  disabled={pending}
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                />
              </Field>
              <Button
                variant="primary"
                type="submit"
                iconEnd={<ArrowRight />}
                disabled={pending || email.trim().length === 0}
              >
                {pending ? 'Sending the code' : 'Continue with email'}
              </Button>
            </form>

            {githubEnabled ? (
              <>
                <div className="my-5 flex items-center gap-3 text-[12px] text-fg-3">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>
                <Button
                  className="w-full"
                  disabled={pending}
                  onClick={() => {
                    void continueWithGithub();
                  }}
                >
                  Continue with GitHub
                </Button>
              </>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <OtpInput
              autoFocus
              disabled={pending}
              invalid={error !== null}
              onComplete={(code) => {
                void submitCode(code);
              }}
            />
            <div className="flex items-center justify-between gap-3">
              <Button
                size="sm"
                variant="ghost"
                iconStart={<ArrowLeft />}
                disabled={pending}
                onClick={() => {
                  setStep('email');
                  setError(null);
                }}
              >
                Change email
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || cooldown > 0}
                onClick={() => {
                  void requestCode();
                }}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </Button>
            </div>
          </div>
        )}

        {error !== null ? (
          <p role="alert" className="mt-4 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </Card>

      <p className="mt-6 text-center text-[12px] text-fg-3">
        By continuing you agree to the Terms and the Privacy policy.
      </p>
    </div>
  );
}
