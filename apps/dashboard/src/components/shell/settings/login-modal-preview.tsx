'use client';

import {
  resolveAccentColors,
  THEME_SURFACE,
  THEME_TEXT,
  type Appearance,
  type LoginMethod,
} from '@pockey/types';
import { Mail, ScanFace, Wallet } from 'lucide-react';
import { useSyncExternalStore } from 'react';

const query = '(prefers-color-scheme: dark)';

function subscribe(callback: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', callback);
  return () => {
    media.removeEventListener('change', callback);
  };
}

function usePrefersDark(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => true,
  );
}

const methodLabels: Record<LoginMethod, string> = {
  email: 'Continue with email',
  google: 'Continue with Google',
  apple: 'Continue with Apple',
  passkey: 'Continue with passkey',
  wallet: 'Connect a wallet',
};

export interface LoginModalPreviewProps {
  name: string;
  appearance: Pick<Appearance, 'theme' | 'accent'>;
  loginMethods: readonly LoginMethod[];
}

/**
 * Small live preview of the embedded login modal. First version of the
 * "preview live du modal" from spec T5.2: theme + accent + enabled methods.
 * TODO(T5.2): render the real modal package instead of this mock.
 */
export function LoginModalPreview({ name, appearance, loginMethods }: LoginModalPreviewProps) {
  const prefersDark = usePrefersDark();
  const dark = appearance.theme === 'dark' || (appearance.theme === 'system' && prefersDark);
  // Same rule as the embed: white text first, inverted accent when it melts into the surface.
  const colors = resolveAccentColors(appearance.accent, dark ? 'dark' : 'light');
  const hasEmail = loginMethods.includes('email');
  const secondary = loginMethods.filter((m) => m !== 'email');

  const bg = THEME_SURFACE[dark ? 'dark' : 'light'];
  const fg = THEME_TEXT[dark ? 'dark' : 'light'];
  const muted = dark ? '#8a8a8a' : '#6b6b6b';
  const field = dark ? '#1c1c1c' : '#f4f4f5';
  const ring = dark ? 'oklch(1 0 0 / 0.1)' : 'oklch(0 0 0 / 0.08)';

  return (
    <div
      aria-label="Login modal preview"
      role="img"
      className="rounded-[16px] p-6"
      style={{
        background: dark ? '#050505' : '#e9e9ec',
        boxShadow: 'var(--shadow-border)',
      }}
    >
      <div
        className="mx-auto w-[260px] rounded-[16px] p-4 text-left"
        style={{ background: bg, color: fg, boxShadow: `0 0 0 1px ${ring}` }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block size-6 rounded-[6px]"
            style={{ background: colors.accent }}
            aria-hidden="true"
          />
          <span className="text-[13px] font-semibold">{name || 'Your app'}</span>
        </div>
        <p className="mt-3 text-[13px] font-medium">Sign in</p>
        <p className="text-[11px]" style={{ color: muted }}>
          A wallet is created for you on first login.
        </p>

        {hasEmail ? (
          <>
            <div
              className="mt-3 flex h-8 items-center rounded-[8px] px-2.5 text-[11px]"
              style={{ background: field, color: muted }}
            >
              <Mail className="me-1.5 size-3.5" strokeWidth={1.5} />
              you@example.com
            </div>
            <div
              className="mt-2 flex h-8 items-center justify-center rounded-[8px] text-[11px] font-medium"
              style={{ background: colors.accent, color: colors.foreground }}
            >
              {methodLabels.email}
            </div>
          </>
        ) : null}

        {secondary.length > 0 ? (
          <div className="mt-2 flex flex-col gap-1.5">
            {secondary.map((method) => (
              <div
                key={method}
                className="flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[11px] font-medium"
                style={{ background: field, color: fg, boxShadow: `0 0 0 1px ${ring}` }}
              >
                {method === 'passkey' ? (
                  <ScanFace className="size-3.5" strokeWidth={2} />
                ) : method === 'wallet' ? (
                  <Wallet className="size-3.5" strokeWidth={2} />
                ) : (
                  <span
                    className="inline-block size-3.5 rounded-full"
                    style={{ background: muted }}
                    aria-hidden="true"
                  />
                )}
                {methodLabels[method]}
              </div>
            ))}
          </div>
        ) : null}

        {loginMethods.length === 0 ? (
          <p className="mt-3 text-[11px]" style={{ color: muted }}>
            Enable at least one login method.
          </p>
        ) : null}

        <p className="mt-3 text-center text-[10px]" style={{ color: muted }}>
          Secured by Pockey
        </p>
      </div>
    </div>
  );
}
