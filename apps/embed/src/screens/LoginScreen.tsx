import type { LoginMethod } from '@pockey/types';
import { KeyRound, Lock, Wallet } from '../components/icons';
import { useState, type ReactNode } from 'react';
import { AppLogo } from '../components/AppLogo';
import { Lockup } from '../components/Logo';
import { Row } from '../components/Row';
import { AppleIcon, GoogleIcon } from '../components/icons';
import { ScreenLayout } from '../components/ScreenLayout';
import { PLAUSIBLE_EMAIL } from '../lib/format';
import type { ScreenActions } from '../lib/state';
import type { ScreenProps } from './types';

const METHOD_LABELS: Record<Exclude<LoginMethod, 'email'>, string> = {
  google: 'Google',
  apple: 'Apple',
  passkey: 'Passkey',
  wallet: 'Wallet',
};

function methodIcon(method: Exclude<LoginMethod, 'email'>): ReactNode {
  switch (method) {
    case 'google':
      return <GoogleIcon size={24} />;
    case 'apple':
      return <AppleIcon size={24} />;
    case 'passkey':
      return <KeyRound size={24} aria-hidden="true" />;
    case 'wallet':
      return <Wallet size={24} aria-hidden="true" />;
  }
}

function runMethod(actions: ScreenActions, method: Exclude<LoginMethod, 'email'>): void {
  if (method === 'google' || method === 'apple') actions.loginWithOAuth(method);
  else if (method === 'passkey') actions.loginWithPasskey();
  else actions.openWallets();
}

export function EmailField({ onSubmit }: { onSubmit: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const plausible = PLAUSIBLE_EMAIL.test(email.trim());
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (plausible) onSubmit(email.trim());
      }}
    >
      <label htmlFor="pk-email" className="sr-only">
        Email
      </label>
      <div className="pk-field relative">
        <input
          id="pk-email"
          data-testid="pk-email-input"
          data-autofocus=""
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="you@example.com"
          value={email}
          onChange={(event) => {
            setEmail(event.currentTarget.value);
          }}
          className="h-12 w-full rounded-[var(--pk-radius-control)] bg-surface-2 pr-[116px] pl-4 text-[15px] text-fg placeholder:text-fg-3"
        />
        <span
          className="pk-reveal absolute top-1 right-1 bottom-1 flex"
          data-shown={String(plausible)}
        >
          <button
            type="submit"
            data-testid="pk-email-continue"
            tabIndex={plausible ? 0 : -1}
            aria-hidden={!plausible}
            className="pk-press h-10 rounded-lg bg-accent px-3.5 text-[15px] font-medium text-accent-fg hover:bg-accent-hover"
          >
            Continue
          </button>
        </span>
      </div>
    </form>
  );
}

export function LoginScreen({ actions, app, titleId }: ScreenProps<'login'>) {
  const hasEmail = app.loginMethods.includes('email');
  const others = app.loginMethods.filter(
    (method): method is Exclude<LoginMethod, 'email'> => method !== 'email',
  );
  return (
    <ScreenLayout
      titleId={titleId}
      media={<AppLogo name={app.name} logo={app.logo} hostOrigin={app.hostOrigin} />}
      label={app.name}
      title="Log in or sign up"
      subtitle={`to ${app.name}`}
      onClose={actions.dismiss}
      footer={
        <p className="flex items-center justify-center gap-1.5 text-[13px] leading-5 text-fg-2">
          <Lock size={13} aria-hidden="true" className="text-fg-3" />
          Protected by
          <Lockup height={13} aria-label="Pockey" className="text-fg" />
        </p>
      }
    >
      {hasEmail ? <EmailField onSubmit={actions.submitEmail} /> : null}
      {hasEmail && others.length > 0 ? (
        <p className="my-4 text-center text-[13px] leading-5 text-fg-3" aria-hidden="true">
          or pick a way to sign in
        </p>
      ) : null}
      {others.length > 0 ? (
        <div className="flex flex-col gap-2">
          {others.map((method, index) => (
            <Row
              key={method}
              mark={methodIcon(method)}
              data-autofocus={!hasEmail && index === 0 ? '' : undefined}
              onClick={() => {
                runMethod(actions, method);
              }}
            >
              {METHOD_LABELS[method]}
            </Row>
          ))}
        </div>
      ) : null}
    </ScreenLayout>
  );
}
