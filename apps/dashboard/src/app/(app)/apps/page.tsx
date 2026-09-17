import type { Metadata } from 'next';
import { AppsList } from '@/components/apps/apps-list';
import { LoginScreen } from '@/components/auth/login-screen';
import { fetchApps, tryFetch } from '@/lib/api.server';

export const metadata: Metadata = { title: 'Apps' };

export default async function AppsPage() {
  const loaded = await tryFetch(fetchApps);
  if (!loaded.ok) return <LoginScreen />;
  return <AppsList apps={loaded.data} />;
}
