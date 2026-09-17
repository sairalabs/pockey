import type { Metadata } from 'next';
import { HomeView } from '@/components/apps/home-view';
import { LoginScreen } from '@/components/auth/login-screen';
import { fetchSponsorBalance, fetchUsage, loadApp, tryFetch } from '@/lib/api.server';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const loaded = await loadApp(id);
  return { title: loaded.ok ? loaded.data.app.name : 'App' };
}

export default async function AppHomePage({ params }: { params: Params }) {
  const { id } = await params;
  const app = await loadApp(id);
  if (!app.ok) return <LoginScreen />;

  const loaded = await tryFetch(async () => ({
    usage: await fetchUsage(id, '7d'),
    sponsor: await fetchSponsorBalance(id),
  }));
  if (!loaded.ok) return <LoginScreen />;

  return <HomeView app={app.data} usage={loaded.data.usage} sponsor={loaded.data.sponsor} />;
}
