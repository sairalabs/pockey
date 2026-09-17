import type { Metadata } from 'next';
import { UsersView } from '@/components/apps/users-view';
import { LoginScreen } from '@/components/auth/login-screen';
import { fetchEndUsers, loadApp, tryFetch } from '@/lib/api.server';

export const metadata: Metadata = { title: 'Users' };

export default async function UsersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await loadApp(id);
  if (!app.ok) return <LoginScreen />;

  const users = await tryFetch(() => fetchEndUsers(id));
  if (!users.ok) return <LoginScreen />;

  return <UsersView appId={app.data.app.id} initial={users.data} />;
}
