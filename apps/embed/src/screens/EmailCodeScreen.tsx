import { Mail } from '../components/icons';
import { useEffect, useState } from 'react';
import { OtpInput } from '../components/OtpInput';
import { IconTile, ScreenLayout } from '../components/ScreenLayout';
import { Spinner } from '../components/Spinner';
import { formatCountdown } from '../lib/format';
import type { ScreenProps } from './types';

function useSecondsUntil(target: number): number {
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.ceil((target - Date.now()) / 1000)),
  );
  useEffect(() => {
    const tick = () => {
      setSeconds(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    };
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [target]);
  return seconds;
}

export function EmailCodeScreen({ screen, actions, titleId }: ScreenProps<'emailCode'>) {
  const seconds = useSecondsUntil(screen.resendAt);
  const verifying = screen.status === 'verifying';
  return (
    <ScreenLayout
      titleId={titleId}
      media={
        <IconTile>
          <Mail size={24} aria-hidden="true" />
        </IconTile>
      }
      title="Check your email"
      subtitle={
        <>
          Enter the 6 digit code sent to <span className="font-medium text-fg">{screen.email}</span>
        </>
      }
      onBack={actions.back}
      onClose={actions.dismiss}
      status={
        screen.error ? (
          <p className="mt-3 text-center text-[13px] leading-5 text-danger">{screen.error}</p>
        ) : null
      }
      footer={
        <div className="flex h-10 items-center justify-center text-[13px] leading-5">
          {verifying ? (
            <span className="flex items-center gap-2 text-fg-2">
              <Spinner size={14} />
              Checking code
            </span>
          ) : seconds > 0 ? (
            <span className="text-fg-3 tabular-nums">
              Resend code in {formatCountdown(seconds)}
            </span>
          ) : (
            <button
              type="button"
              onClick={actions.resendCode}
              className="pk-press h-10 rounded-lg px-3 font-medium text-fg-2 hover:text-fg"
            >
              Resend code
            </button>
          )}
        </div>
      }
    >
      <OtpInput
        key={screen.resetKey}
        onComplete={actions.verifyCode}
        disabled={verifying}
        invalid={screen.error !== null}
        initialFocus
        autoFocus={screen.resetKey > 0}
      />
    </ScreenLayout>
  );
}
