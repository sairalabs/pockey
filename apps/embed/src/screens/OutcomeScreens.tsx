import { Check, CircleAlert, Info, TriangleAlert } from '../components/icons';
import { m, useReducedMotion } from 'motion/react';
import { Button } from '../components/Button';
import { CopyButton } from '../components/CopyButton';
import { DetailList, DetailRow, WalletAddress } from '../components/Details';
import { HoldButton } from '../components/HoldButton';
import { ErrorText, IconTile, ScreenLayout } from '../components/ScreenLayout';
import type { ScreenProps } from './types';

const SWAP_EASE = [0.2, 0, 0, 1] as const;

export function SuccessScreen({ screen, titleId }: ScreenProps<'success'>) {
  const reduced = useReducedMotion() ?? false;
  return (
    <ScreenLayout
      titleId={titleId}
      media={
        <IconTile tone="accent" size={64}>
          <m.span
            className="flex"
            initial={
              reduced
                ? { opacity: 0 }
                : { opacity: 0, transform: 'scale(0.25)', filter: 'blur(4px)' }
            }
            animate={
              reduced
                ? { opacity: 1 }
                : {
                    opacity: 1,
                    transform: 'scale(1)',
                    filter: 'blur(0px)',
                    transitionEnd: { filter: 'none' },
                  }
            }
            transition={{ duration: 0.3, ease: SWAP_EASE }}
          >
            <Check size={30} aria-hidden="true" />
          </m.span>
        </IconTile>
      }
      title={screen.title}
    />
  );
}

export function ExportScreen({ screen, actions, titleId }: ScreenProps<'export'>) {
  const { status } = screen;
  const done = status === 'revealed' || status === 'simulated';
  return (
    <ScreenLayout
      titleId={titleId}
      media={
        <IconTile tone="danger">
          <TriangleAlert size={24} aria-hidden="true" />
        </IconTile>
      }
      title="Export private key"
      subtitle="Anyone with this key has full control of this wallet. Never share it."
      onClose={status === 'revealing' ? undefined : actions.dismiss}
      status={
        status === 'error' && screen.error ? <ErrorText>{screen.error.message}</ErrorText> : null
      }
      footer={
        done ? (
          <Button data-autofocus="" onClick={actions.finish}>
            Done
          </Button>
        ) : status === 'revealing' ? (
          <Button pending disabled={false}>
            Hold to reveal
          </Button>
        ) : (
          <HoldButton onComplete={actions.reveal}>
            {status === 'error' ? 'Hold to try again' : 'Hold to reveal'}
          </HoldButton>
        )
      }
    >
      <DetailList>
        <DetailRow label="Wallet">
          <WalletAddress wallet={screen.wallet} />
        </DetailRow>
      </DetailList>
      {status === 'revealed' && screen.privateKey ? (
        <div className="mt-3 flex items-start gap-1 rounded-xl bg-surface-2 py-2 pr-2 pl-4">
          <p className="min-w-0 flex-1 py-2 text-[13px] leading-5 break-all text-fg">
            {screen.privateKey}
          </p>
          <CopyButton value={screen.privateKey} label="Copy private key" />
        </div>
      ) : null}
      {status === 'simulated' ? (
        <div className="mt-3 flex items-start gap-3 rounded-xl bg-surface-2 px-4 py-3">
          <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-fg-2" />
          <p className="text-[13px] leading-5 text-fg-2">Development build: export is simulated</p>
        </div>
      ) : null}
    </ScreenLayout>
  );
}

export function ErrorScreen({ screen, actions, titleId }: ScreenProps<'error'>) {
  return (
    <ScreenLayout
      titleId={titleId}
      media={
        <IconTile tone="danger">
          <CircleAlert size={24} aria-hidden="true" />
        </IconTile>
      }
      title="Something went wrong"
      subtitle={screen.error.message}
      onClose={actions.dismiss}
      footer={
        <Button data-autofocus="" onClick={actions.finish}>
          Close
        </Button>
      }
    />
  );
}
