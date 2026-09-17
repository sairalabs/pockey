import type { Metadata } from 'next';
import { KeysView } from '@/components/apps/keys-view';
import { LoginScreen } from '@/components/auth/login-screen';
import { fetchApiKeys, loadApp, tryFetch } from '@/lib/api.server';

export const metadata: Metadata = { title: 'API keys' };

export default async function KeysPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await loadApp(id);
  if (!app.ok) return <LoginScreen />;

  const keys = await tryFetch(() => fetchApiKeys(id));
  if (!keys.ok) return <LoginScreen />;

  return <KeysView app={app.data} initialKeys={keys.data.keys} />;
}
