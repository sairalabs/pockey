import {
  AppWindow,
  Bell,
  Fuel,
  KeyRound,
  Palette,
  SlidersHorizontal,
  UserRound,
  Users,
  type IconComponent,
} from '../../ui/icons';

export type SettingsSectionId =
  | 'app-information'
  | 'configuration'
  | 'members'
  | 'api-keys'
  | 'sponsoring'
  | 'account-information'
  | 'notifications'
  | 'appearance';

export interface SettingsItem {
  id: SettingsSectionId;
  label: string;
  icon: IconComponent;
}

export interface SettingsGroup {
  label: string;
  items: readonly SettingsItem[];
}

export const settingsGroups: readonly SettingsGroup[] = [
  {
    label: 'App',
    items: [
      { id: 'app-information', label: 'App information', icon: AppWindow },
      { id: 'configuration', label: 'Configuration', icon: SlidersHorizontal },
      { id: 'members', label: 'Members', icon: Users },
      { id: 'api-keys', label: 'API keys', icon: KeyRound },
      { id: 'sponsoring', label: 'Sponsoring', icon: Fuel },
    ],
  },
  {
    label: 'Account',
    items: [{ id: 'account-information', label: 'Account information', icon: UserRound }],
  },
  {
    label: 'General',
    items: [
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'appearance', label: 'Appearance', icon: Palette },
    ],
  },
];
