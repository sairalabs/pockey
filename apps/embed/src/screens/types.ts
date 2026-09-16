import type { LoginMethod } from '@pocketkey/types';
import type { ScreenActions, ScreenName, ScreenOf } from '../lib/state';

export interface AppInfo {
  name: string;
  logo?: string | undefined;
  hostOrigin: string | null;
  loginMethods: LoginMethod[];
}

export interface ScreenProps<N extends ScreenName> {
  screen: ScreenOf<N>;
  actions: ScreenActions;
  app: AppInfo;
  titleId: string;
}
