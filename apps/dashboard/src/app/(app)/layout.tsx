import type { ReactNode } from 'react';
import { LoginScreen } from '@/components/auth/login-screen';
import { Shell } from '@/components/shell/shell';
import { fetchApps, fetchSession, tryFetch } from '@/lib/api.server';

export const dynamic = 'force-dynamic';

/**
 * Every page of the dashboard hangs here, so the session is read once. No
 * session means the login screen instead of the shell: the API answers 401 and
 * never a redirect, the dashboard decides what to show.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const loaded = await tryFetch(async () => ({
    session: await fetchSession(),
    apps: await fetchApps(),
  }));
  if (!loaded.ok) return <LoginScreen />;

  return (
    <Shell developer={loaded.data.session.developer} apps={loaded.data.apps}>
      {children}
    </Shell>
  );
}
