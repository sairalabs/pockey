import { LazyMotion } from 'motion/react';
import { Component, useCallback, type ErrorInfo, type ReactNode } from 'react';
import { EmbedDialog } from './components/Dialog';
import { useMediaQuery, useStore } from './components/hooks';
import { loadMotionFeatures } from './components/motion';
import { ThemeScope } from './components/ThemeScope';
import { appDisplayName } from './lib/config';
import type { EmbedStore, ScreenActions } from './lib/state';
import { ErrorScreen } from './screens/OutcomeScreens';
import { ScreenView, titleIdFor } from './screens/ScreenView';

class ScreenBoundary extends Component<
  { fallback: (error: Error) => ReactNode; children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error('Unexpected error.') };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[pocketkey] screen crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

export function App({ store, actions }: { store: EmbedStore; actions: ScreenActions }) {
  const state = useStore(store);
  const narrow = useMediaQuery('(max-width: 479px)');
  const { config, screen, nav } = state;
  const titleId = titleIdFor(nav.key);

  const onExitComplete = useCallback(() => {
    if (store.get().phase === 'closing') store.set({ phase: 'closed', screen: null });
  }, [store]);

  const app = config
    ? {
        name: appDisplayName(config),
        logo: config.appearance.logo,
        hostOrigin: state.hostOrigin,
        loginMethods: config.loginMethods,
      }
    : null;

  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <ThemeScope
        theme={config?.appearance.theme ?? 'system'}
        accent={config?.appearance.accent ?? '#7c3aed'}
      >
        <EmbedDialog
          open={state.phase === 'open' && screen !== null && app !== null}
          variant={narrow ? 'sheet' : 'dialog'}
          nav={nav}
          labelledBy={titleId}
          keyboardClose={state.closeKeyboard}
          onDismiss={actions.dismiss}
          onExitComplete={onExitComplete}
        >
          {screen && app ? (
            <ScreenBoundary
              key={nav.key}
              fallback={(error) => (
                <ErrorScreen
                  screen={{ name: 'error', error: { code: 'internal', message: error.message } }}
                  actions={actions}
                  app={app}
                  titleId={titleId}
                />
              )}
            >
              <ScreenView screen={screen} actions={actions} app={app} titleId={titleId} />
            </ScreenBoundary>
          ) : null}
        </EmbedDialog>
      </ThemeScope>
    </LazyMotion>
  );
}
