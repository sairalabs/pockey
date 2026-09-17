import type { Metadata } from 'next';
import { UsageView } from '@/components/apps/usage-view';
import { LoginScreen } from '@/components/auth/login-screen';
import { fetchUsage, loadApp, tryFetch } from '@/lib/api.server';

export const metadata: Metadata = { title: 'Usage' };

export default async function UsagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await loadApp(id);
  if (!app.ok) return <LoginScreen />;

  const usage = await tryFetch(() => fetchUsage(id, '30d'));
  if (!usage.ok) return <LoginScreen />;

  return <UsageView app={app.data} usage={usage.data} />;
}
