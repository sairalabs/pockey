'use client';

import {
  type AdminApp,
  AppConfig,
  type CreateOnLogin,
  type EvmChainId,
  type LoginMethod,
  normalizeHexColor,
  type SolanaCluster,
  textOnColor,
} from '@pockey/types';
import { Check, Pipette } from '../../ui/icons';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { PillSelect } from '@/components/ui/pill-select';
import { Segmented } from '@/components/ui/segmented';
import { SwitchRow } from '@/components/ui/switch';
import { errorMessage, saveAppConfig } from '@/lib/api';
import { cn } from '@/lib/cn';
import { LoginModalPreview } from './login-modal-preview';
import { Pane, PaneSection, SavedHint } from './pane';

const loginMethodRows: readonly { value: LoginMethod; label: string; description: string }[] = [
  { value: 'email', label: 'Email', description: 'One-time code sent by email.' },
  { value: 'google', label: 'Google', description: 'OAuth with a Google account.' },
  { value: 'apple', label: 'Apple', description: 'Sign in with Apple.' },
  { value: 'passkey', label: 'Passkeys', description: 'WebAuthn, no password.' },
  {
    value: 'wallet',
    label: 'External wallet',
    description: 'Sign a message with an existing wallet.',
  },
];

const evmChainRows: readonly { id: EvmChainId; label: string }[] = [
  { id: 8453, label: 'Base' },
  { id: 42161, label: 'Arbitrum' },
  { id: 1, label: 'Ethereum' },
  { id: 137, label: 'Polygon' },
];

const solanaMainnet: SolanaCluster = 'mainnet-beta';

const createOnLoginOptions: readonly { value: CreateOnLogin; label: string }[] = [
  { value: 'all', label: 'All chains' },
  { value: 'evm', label: 'EVM only' },
  { value: 'solana', label: 'Solana only' },
  { value: 'off', label: 'Off' },
];

const themeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

const accentSwatches = [
  '#d2042d',
  '#0052ff',
  '#059669',
  '#db2777',
  '#ea580c',
  '#0891b2',
  '#111111',
] as const;

type Theme = (typeof themeOptions)[number]['value'];

function toggleIn<T>(list: readonly T[], value: T, enabled: boolean): T[] {
  if (enabled) return list.includes(value) ? [...list] : [...list, value];
  return list.filter((item) => item !== value);
}

export function ConfigurationPane({ app }: { app: AdminApp }) {
  const id = useId();
  const router = useRouter();
  const [draft, setDraft] = useState<AppConfig>(() => structuredClone(app.app.config));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const isCustomAccent = !(accentSwatches as readonly string[]).includes(
    draft.appearance.accent.toLowerCase(),
  );

  const update = (patch: (current: AppConfig) => AppConfig) => {
    setDraft((current) => patch(current));
    setError(null);
  };

  const save = async () => {
    const parsed = AppConfig.safeParse(draft);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid configuration');
      return;
    }

    setPending(true);
    setError(null);
    try {
      // PUT replaces the whole config, so the draft is sent as one document.
      const updated = await saveAppConfig(app.app.id, parsed.data);
      setDraft(structuredClone(updated.app.config));
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 1500);
      // The SDK reads the same config through the public endpoint.
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, 'Could not save the configuration'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Pane
      title="Configuration"
      actions={
        <>
          <SavedHint visible={saved} />
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() => {
              void save();
            }}
          >
            {pending ? 'Saving' : 'Save'}
          </Button>
        </>
      }
    >
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-[10px] bg-danger/10 px-3 py-2 text-[13px] text-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="divide-y divide-border">
        <PaneSection
          title="Login methods"
          description="What end users see in the modal. At least one method is required."
        >
          <div className="divide-y divide-border">
            {loginMethodRows.map((row) => (
              <SwitchRow
                key={row.value}
                title={row.label}
                description={row.description}
                checked={draft.loginMethods.includes(row.value)}
                onCheckedChange={(checked) => {
                  update((c) => ({
                    ...c,
                    loginMethods: toggleIn(c.loginMethods, row.value, checked),
                  }));
                }}
              />
            ))}
          </div>
        </PaneSection>

        <PaneSection title="Chains" description="Networks wallets can transact on.">
          <div className="divide-y divide-border">
            {evmChainRows.map((row) => (
              <SwitchRow
                key={row.id}
                title={row.label}
                description={`EVM, chain id ${row.id}`}
                checked={draft.chains.evm.includes(row.id)}
                onCheckedChange={(checked) => {
                  update((c) => ({
                    ...c,
                    chains: { ...c.chains, evm: toggleIn(c.chains.evm, row.id, checked) },
                  }));
                }}
              />
            ))}
            <SwitchRow
              title="Solana mainnet"
              description="ed25519 wallets on mainnet-beta"
              checked={draft.chains.solana.includes(solanaMainnet)}
              onCheckedChange={(checked) => {
                update((c) => ({
                  ...c,
                  chains: {
                    ...c.chains,
                    solana: toggleIn(c.chains.solana, solanaMainnet, checked),
                  },
                }));
              }}
            />
          </div>
        </PaneSection>

        <PaneSection
          title="Embedded wallets"
          description="Which wallets are created automatically on first login."
        >
          <div className="flex items-center justify-between gap-6 py-1">
            <span className="text-sm font-medium">Create on login</span>
            <PillSelect
              aria-label="Create wallets on login"
              value={draft.embeddedWallets.createOnLogin}
              options={createOnLoginOptions}
              onValueChange={(value) => {
                update((c) => ({ ...c, embeddedWallets: { createOnLogin: value } }));
              }}
            />
          </div>
        </PaneSection>

        <PaneSection title="Appearance" description="Theme and accent of the login modal.">
          <div className="grid gap-6 md:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-medium text-fg-2">Theme</span>
                <Segmented<Theme>
                  aria-label="Modal theme"
                  value={draft.appearance.theme}
                  options={themeOptions}
                  onValueChange={(theme) => {
                    update((c) => ({ ...c, appearance: { ...c.appearance, theme } }));
                  }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-medium text-fg-2">Accent</span>
                <div className="flex flex-wrap items-center gap-2">
                  {accentSwatches.map((swatch) => {
                    const selected = draft.appearance.accent.toLowerCase() === swatch;
                    return (
                      <button
                        key={swatch}
                        type="button"
                        aria-label={`Accent ${swatch}`}
                        aria-pressed={selected}
                        onClick={() => {
                          update((c) => ({
                            ...c,
                            appearance: { ...c.appearance, accent: swatch },
                          }));
                        }}
                        className={cn(
                          'flex size-8 items-center justify-center rounded-full',
                          'transition-[transform,box-shadow] duration-150 ease-out active:scale-[0.96]',
                          selected ? 'shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--text)]' : '',
                        )}
                        style={{ background: swatch, color: textOnColor(swatch) }}
                      >
                        {selected ? <Check className="size-4" /> : null}
                      </button>
                    );
                  })}
                  <label
                    htmlFor={`${id}-accent-native`}
                    title="Custom color"
                    className={cn(
                      'relative flex size-8 cursor-pointer items-center justify-center rounded-full',
                      'transition-[transform,box-shadow] duration-150 ease-out active:scale-[0.96]',
                      isCustomAccent ? 'shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--text)]' : '',
                    )}
                    style={{
                      background: isCustomAccent
                        ? (normalizeHexColor(draft.appearance.accent) ?? 'transparent')
                        : 'conic-gradient(from 90deg, #d2042d, #f59e0b, #16a34a, #0891b2, #0052ff, #db2777, #d2042d)',
                    }}
                  >
                    <Pipette
                      className="size-3.5"
                      style={{
                        color: isCustomAccent ? textOnColor(draft.appearance.accent) : '#ffffff',
                      }}
                      aria-hidden="true"
                    />
                    <input
                      id={`${id}-accent-native`}
                      type="color"
                      aria-label="Custom accent color"
                      value={normalizeHexColor(draft.appearance.accent) ?? '#d2042d'}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      onChange={(event) => {
                        const accent = event.target.value;
                        update((c) => ({ ...c, appearance: { ...c.appearance, accent } }));
                      }}
                    />
                  </label>
                  <label htmlFor={`${id}-accent`} className="sr-only">
                    Custom accent hex
                  </label>
                  <Input
                    id={`${id}-accent`}
                    value={draft.appearance.accent}
                    maxLength={7}
                    spellCheck={false}
                    className="h-8 w-28 text-[13px] tabular-nums uppercase"
                    onChange={(event) => {
                      const accent = normalizeHexColor(event.target.value) ?? event.target.value;
                      update((c) => ({ ...c, appearance: { ...c.appearance, accent } }));
                    }}
                  />
                </div>
              </div>
              <Field
                label="Display name"
                htmlFor={`${id}-modal-name`}
                hint="Shown in the login modal. Defaults to the app name."
              >
                <Input
                  id={`${id}-modal-name`}
                  value={draft.appearance.name ?? ''}
                  maxLength={40}
                  placeholder={app.app.name}
                  onChange={(event) => {
                    const value = event.target.value;
                    update((c) => {
                      const { name: _dropped, ...rest } = c.appearance;
                      return {
                        ...c,
                        appearance: value.length > 0 ? { ...rest, name: value } : rest,
                      };
                    });
                  }}
                />
              </Field>
              <Field
                label="Logo URL"
                htmlFor={`${id}-logo`}
                hint="Absolute URL or a path served by your own origin."
              >
                <Input
                  id={`${id}-logo`}
                  value={draft.appearance.logo ?? ''}
                  maxLength={2048}
                  spellCheck={false}
                  className="text-[13px] tabular-nums"
                  placeholder="https://example.com/logo.svg"
                  onChange={(event) => {
                    const value = event.target.value;
                    update((c) => {
                      const { logo: _dropped, ...rest } = c.appearance;
                      return {
                        ...c,
                        appearance: value.length > 0 ? { ...rest, logo: value } : rest,
                      };
                    });
                  }}
                />
              </Field>
            </div>
            <LoginModalPreview
              name={draft.appearance.name ?? app.app.name}
              appearance={draft.appearance}
              loginMethods={draft.loginMethods}
            />
          </div>
        </PaneSection>
      </div>
    </Pane>
  );
}
