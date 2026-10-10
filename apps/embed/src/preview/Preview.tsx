import { clsx } from 'clsx';
import { Moon, RotateCcw, Smartphone, Sun } from 'lucide-react';
import { LazyMotion, useReducedMotion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { DialogPanel } from '../components/Dialog';
import { loadMotionFeatures } from '../components/motion';
import { ThemeScope } from '../components/ThemeScope';
import { noopActions, type Nav } from '../lib/state';
import { ScreenView } from '../screens/ScreenView';
import type { AppInfo } from '../screens/types';
import { ACCENT_PRESETS, AccentPicker } from './AccentPicker';
import { DevFeedback } from './DevFeedback';
import { PREVIEW_METHODS, PREVIEW_ORIGIN, previewCards, type PreviewCard } from './mocks';

const NAV: Nav = { key: 1, direction: 1, keyboard: false };

function Segment({
  pressed,
  onClick,
  children,
  label,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={clsx(
        'pk-press inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium',
        pressed ? 'bg-surface text-fg shadow-[var(--shadow-panel)]' : 'text-fg-2 hover:text-fg',
      )}
    >
      {children}
      {label}
    </button>
  );
}

function FauxHost() {
  return (
    <div aria-hidden="true" className="absolute inset-0 flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="h-3 w-24 rounded-full bg-surface-3" />
        <div className="h-8 w-20 rounded-lg bg-surface-3" />
      </div>
      <div className="mt-6 h-6 w-2/3 rounded-full bg-surface-3" />
      <div className="h-3 w-5/6 rounded-full bg-surface-3" />
      <div className="h-3 w-3/5 rounded-full bg-surface-3" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="h-28 rounded-2xl bg-surface-3" />
        <div className="h-28 rounded-2xl bg-surface-3" />
      </div>
    </div>
  );
}

function Card({ card, app, mobile }: { card: PreviewCard; app: AppInfo; mobile: boolean }) {
  const [replay, setReplay] = useState(0);
  const reduced = useReducedMotion() ?? false;
  const titleId = `pk-preview-${card.id}`;
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={`${titleId}-label`}>
      <div
        className={clsx(
          'mx-auto flex w-full items-center justify-between gap-3',
          mobile && 'max-w-[375px]',
        )}
      >
        <h2 id={`${titleId}-label`} className="text-[13px] font-medium text-fg-2">
          {card.label}
        </h2>
        <button
          type="button"
          onClick={() => {
            setReplay((value) => value + 1);
          }}
          className="pk-press -my-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-fg-2 hover:text-fg"
        >
          <RotateCcw size={14} strokeWidth={1.5} aria-hidden="true" />
          Replay
        </button>
      </div>
      <div
        className={clsx(
          'pk-preview-stage relative isolate mx-auto w-full overflow-hidden rounded-[20px] bg-surface-2 shadow-[var(--shadow-panel)]',
          mobile ? 'h-[720px] max-w-[375px]' : 'h-[680px]',
        )}
      >
        <FauxHost />
        <div className="absolute inset-0 bg-[var(--backdrop)] backdrop-blur-[4px]" />
        <div
          className={clsx(
            'absolute inset-0 flex justify-center',
            mobile ? 'items-end' : 'items-center p-4',
          )}
        >
          <DialogPanel
            key={replay}
            variant={mobile ? 'sheet' : 'dialog'}
            labelledBy={titleId}
            nav={NAV}
            reduced={reduced}
          >
            <ScreenView screen={card.screen} actions={noopActions} app={app} titleId={titleId} />
          </DialogPanel>
        </div>
      </div>
    </section>
  );
}

export function Preview({ appId }: { appId: string }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [accent, setAccent] = useState<string>(ACCENT_PRESETS[0]);
  const [mobile, setMobile] = useState(false);
  const [cards] = useState(() => previewCards(Date.now()));
  const app: AppInfo = {
    name: 'Playground',
    hostOrigin: PREVIEW_ORIGIN,
    loginMethods: PREVIEW_METHODS,
  };

  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <ThemeScope theme={theme} accent={accent} className="min-h-dvh bg-surface">
        <header className="sticky top-0 z-10 border-b border-ring bg-surface/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold text-fg">Pocketkey embed preview</h1>
              <p className="truncate text-[13px] text-fg-2 tabular-nums">
                {appId || 'No appId'} · mock data, no network
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-xl bg-surface-2 p-0.5" role="group" aria-label="Theme">
                <Segment
                  pressed={theme === 'light'}
                  onClick={() => {
                    setTheme('light');
                  }}
                  label="Light"
                >
                  <Sun size={14} strokeWidth={2} aria-hidden="true" />
                </Segment>
                <Segment
                  pressed={theme === 'dark'}
                  onClick={() => {
                    setTheme('dark');
                  }}
                  label="Dark"
                >
                  <Moon size={14} strokeWidth={2} aria-hidden="true" />
                </Segment>
              </div>
              <AccentPicker value={accent} mode={theme} onChange={setAccent} />
              <div className="flex rounded-xl bg-surface-2 p-0.5">
                <Segment
                  pressed={mobile}
                  onClick={() => {
                    setMobile((value) => !value);
                  }}
                  label="Mobile"
                >
                  <Smartphone size={14} strokeWidth={2} aria-hidden="true" />
                </Segment>
              </div>
            </div>
          </div>
        </header>
        <main
          className={clsx(
            'mx-auto grid max-w-[1440px] gap-x-6 gap-y-10 px-4 py-8 sm:px-6',
            mobile
              ? 'grid-cols-[repeat(auto-fill,minmax(min(100%,375px),1fr))]'
              : 'grid-cols-[repeat(auto-fill,minmax(min(100%,428px),1fr))]',
          )}
        >
          {cards.map((card) => (
            <Card key={card.id} card={card} app={app} mobile={mobile} />
          ))}
        </main>
        <DevFeedback appName="Pocketkey embed screens" />
      </ThemeScope>
    </LazyMotion>
  );
}
