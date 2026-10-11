import { KeyRound, RotateCcw, Wallet } from '../components/icons';
import { Button } from '../components/Button';
import { Row } from '../components/Row';
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
      label="Passkey"
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
      label={name}
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

const WALLET_BOX = {
  40: 'size-10 rounded-[var(--pk-radius-mark)]',
  80: 'size-20 rounded-[calc(var(--pk-radius-mark)*2)]',
} as const;

export function WalletIcon({ wallet, size = 40 }: { wallet: WalletOption; size?: 40 | 80 }) {
  const box = WALLET_BOX[size];
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
    <span className={`flex shrink-0 items-center justify-center bg-surface-2 text-fg-2 ${box}`}>
      <Wallet size={size === 80 ? 40 : 22} aria-hidden="true" />
    </span>
  );
}

/** The wallet mark on a status screen, ringed in danger when the request failed. */
function WalletMark({ wallet, failed }: { wallet: WalletOption; failed: boolean }) {
  return (
    <span className="relative inline-flex">
      <WalletIcon wallet={wallet} size={80} />
      {failed ? (
        <>
          <span
            aria-hidden="true"
            className="absolute -inset-1.5 rounded-[28px] shadow-[inset_0_0_0_3px_var(--danger)]"
          />
          <span
            aria-hidden="true"
            className="absolute -right-2 -bottom-2 flex size-8 items-center justify-center rounded-full bg-surface text-fg shadow-[var(--shadow-panel)]"
          >
            <RotateCcw size={18} />
          </span>
        </>
      ) : null}
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
      label="Connect a wallet"
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
              <Row
                data-autofocus={index === 0 ? '' : undefined}
                note={FAMILY_LABEL[option.family]}
                mark={<WalletIcon wallet={option} />}
                onClick={() => {
                  actions.chooseWallet(option.id);
                }}
              >
                {option.name}
              </Row>
            </li>
          ))}
        </ul>
      )}
    </ScreenLayout>
  );
}

export function WalletConfirmScreen({ screen, actions, titleId }: ScreenProps<'walletConfirm'>) {
  const failed = screen.status === 'cancelled' || screen.status === 'error';
  const subtitle =
    screen.status === 'cancelled'
      ? 'You cancelled the request. Try again above.'
      : screen.status === 'error'
        ? (screen.message ?? 'Something went wrong.')
        : 'Sign the message in your wallet to log in.';
  return (
    <ScreenLayout
      titleId={titleId}
      media={<WalletMark wallet={screen.wallet} failed={failed} />}
      label={screen.wallet.name}
      title={screen.status === 'cancelled' ? 'Request cancelled' : 'Requesting connection'}
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
