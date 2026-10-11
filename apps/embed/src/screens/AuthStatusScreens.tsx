import { KeyRound, Wallet } from '../components/icons';
import { Button } from '../components/Button';
import { AppleIcon, GoogleIcon } from '../components/icons';
import { ScreenIcon, ScreenLayout } from '../components/ScreenLayout';
import { Spinner } from '../components/Spinner';
import type { WalletOption } from '../lib/state';
import type { ScreenProps } from './types';

function Waiting({ label }: { label: string }) {
  return (
    <p
      className="flex items-center justify-center gap-2 text-[13px] leading-5 text-fg-2"
      role="status"
    >
      <Spinner size={16} />
      {label}
    </p>
  );
}

export function PasskeyScreen({ screen, actions, titleId }: ScreenProps<'passkey'>) {
  const register = screen.mode === 'register';
  const failed = screen.status === 'failed';
  const title = failed
    ? register
      ? 'Passkey setup was cancelled'
      : 'Passkey sign in was cancelled'
    : register
      ? 'Create a passkey'
      : 'Use your passkey';
  return (
    <ScreenLayout
      titleId={titleId}
      media={
        <ScreenIcon size={64}>
          <KeyRound size={44} aria-hidden="true" />
        </ScreenIcon>
      }
      title={title}
      subtitle={failed ? (screen.message ?? 'You can try again.') : 'Follow your device prompt'}
      onBack={register ? undefined : actions.back}
      onClose={actions.dismiss}
      footer={
        failed ? (
          <Button variant="primary" data-autofocus="" onClick={actions.retry}>
            Try again
          </Button>
        ) : (
          <Waiting label="Waiting for your device" />
        )
      }
    />
  );
}

const PROVIDER_NAMES = { google: 'Google', apple: 'Apple' } as const;

export function OAuthScreen({ screen, actions, titleId }: ScreenProps<'oauth'>) {
  const name = PROVIDER_NAMES[screen.provider];
  const subtitle =
    screen.status === 'blocked'
      ? 'Your browser blocked the popup.'
      : screen.status === 'error'
        ? (screen.message ?? 'Something went wrong.')
        : `Finish signing in with ${name} in the new window.`;
  return (
    <ScreenLayout
      titleId={titleId}
      media={
        <ScreenIcon>
          {screen.provider === 'google' ? <GoogleIcon size={32} /> : <AppleIcon size={32} />}
        </ScreenIcon>
      }
      title="Continue in the popup"
      subtitle={subtitle}
      onBack={actions.back}
      onClose={actions.dismiss}
      footer={
        screen.status === 'waiting' ? (
          <Waiting label={`Waiting for ${name}`} />
        ) : (
          <Button
            variant="primary"
            data-autofocus=""
            onClick={() => {
              actions.loginWithOAuth(screen.provider);
            }}
          >
            {screen.status === 'blocked' ? `Open ${name}` : 'Try again'}
          </Button>
        )
      }
    />
  );
}

export function WalletIcon({ wallet, size = 32 }: { wallet: WalletOption; size?: 32 | 56 }) {
  const box = size === 56 ? 'size-14 rounded-2xl' : 'size-8 rounded-lg';
  if (wallet.icon) {
    return (
      <img
        src={wallet.icon}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 object-cover ${box}`}
      />
    );
  }
  return (
    <span className={`flex shrink-0 items-center justify-center text-fg-2 ${box}`}>
      <Wallet size={size === 56 ? 32 : 22} aria-hidden="true" />
    </span>
  );
}

const FAMILY_LABEL = { evm: 'Ethereum', solana: 'Solana' } as const;

export function WalletsScreen({ screen, actions, titleId }: ScreenProps<'wallets'>) {
  const empty = screen.status === 'ready' && screen.options.length === 0;
  return (
    <ScreenLayout
      titleId={titleId}
      media={
        <ScreenIcon>
          <Wallet size={32} aria-hidden="true" />
        </ScreenIcon>
      }
      title={empty ? 'No wallet found in this browser' : 'Connect a wallet'}
      subtitle={
        empty
          ? 'Install a wallet extension, then try again.'
          : 'Choose a wallet installed in this browser'
      }
      onBack={actions.back}
      onClose={actions.dismiss}
      footer={
        empty ? (
          <Button data-autofocus="" onClick={actions.retry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      {screen.status === 'discovering' ? (
        <div className="flex h-14 items-center justify-center">
          <Waiting label="Looking for wallets" />
        </div>
      ) : empty ? null : (
        <ul className="flex flex-col gap-2">
          {screen.options.map((option, index) => (
            <li key={option.id}>
              <button
                type="button"
                data-autofocus={index === 0 ? '' : undefined}
                onClick={() => {
                  actions.chooseWallet(option.id);
                }}
                className="pk-press flex h-14 w-full items-center gap-3 rounded-xl bg-surface-2 px-3 text-left hover:bg-surface-3"
              >
                <WalletIcon wallet={option} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-fg">
                  {option.name}
                </span>
                <span className="text-[13px] text-fg-2">{FAMILY_LABEL[option.family]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ScreenLayout>
  );
}

export function WalletConfirmScreen({ screen, actions, titleId }: ScreenProps<'walletConfirm'>) {
  const subtitle =
    screen.status === 'cancelled'
      ? 'The request was cancelled in your wallet.'
      : screen.status === 'error'
        ? (screen.message ?? 'Something went wrong.')
        : 'Sign the message in your wallet to log in.';
  return (
    <ScreenLayout
      titleId={titleId}
      media={<WalletIcon wallet={screen.wallet} size={56} />}
      title={`Confirm in ${screen.wallet.name}`}
      subtitle={subtitle}
      onBack={actions.back}
      onClose={actions.dismiss}
      footer={
        screen.status === 'waiting' ? (
          <Waiting label="Waiting for your wallet" />
        ) : (
          <Button variant="primary" data-autofocus="" onClick={actions.retry}>
            Try again
          </Button>
        )
      }
    />
  );
}
