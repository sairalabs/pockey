import type { Metadata } from 'next';
import { SponsoringView } from '@/components/apps/sponsoring-view';
import { LoginScreen } from '@/components/auth/login-screen';
import { fetchSponsorBalance, loadApp, tryFetch } from '@/lib/api.server';

export const metadata: Metadata = { title: 'Sponsoring' };

export default async function SponsoringPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await loadApp(id);
  if (!app.ok) return <LoginScreen />;

  const balance = await tryFetch(() => fetchSponsorBalance(id));
  if (!balance.ok) return <LoginScreen />;

  return <SponsoringView app={app.data} balance={balance.data} />;
}
