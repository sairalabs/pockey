import type { Screen, ScreenActions } from '../lib/state';
import {
  OAuthScreen,
  PasskeyScreen,
  WalletConfirmScreen,
  WalletsScreen,
} from './AuthStatusScreens';
import { SignMessageScreen, SignTypedDataScreen, TransactionScreen } from './ConfirmScreens';
import { EmailCodeScreen } from './EmailCodeScreen';
import { LoginScreen } from './LoginScreen';
import { ErrorScreen, ExportScreen, SuccessScreen } from './OutcomeScreens';
import { SessionScreen } from './SessionScreen';
import type { AppInfo } from './types';

export function ScreenView({
  screen,
  actions,
  app,
  titleId,
}: {
  screen: Screen;
  actions: ScreenActions;
  app: AppInfo;
  titleId: string;
}) {
  const common = { actions, app, titleId };
  switch (screen.name) {
    case 'login':
      return <LoginScreen screen={screen} {...common} />;
    case 'emailCode':
      return <EmailCodeScreen screen={screen} {...common} />;
    case 'passkey':
      return <PasskeyScreen screen={screen} {...common} />;
    case 'oauth':
      return <OAuthScreen screen={screen} {...common} />;
    case 'wallets':
      return <WalletsScreen screen={screen} {...common} />;
    case 'walletConfirm':
      return <WalletConfirmScreen screen={screen} {...common} />;
    case 'success':
      return <SuccessScreen screen={screen} {...common} />;
    case 'signMessage':
      return <SignMessageScreen screen={screen} {...common} />;
    case 'signTypedData':
      return <SignTypedDataScreen screen={screen} {...common} />;
    case 'transaction':
      return <TransactionScreen screen={screen} {...common} />;
    case 'session':
      return <SessionScreen screen={screen} {...common} />;
    case 'export':
      return <ExportScreen screen={screen} {...common} />;
    case 'error':
      return <ErrorScreen screen={screen} {...common} />;
  }
}

export function titleIdFor(navKey: number): string {
  return `pk-title-${String(navKey)}`;
}
