import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginScreen } from '@/components/auth/login-screen';
import { fetchSession, tryFetch } from '@/lib/api.server';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const session = await tryFetch(fetchSession);
  if (session.ok) redirect('/apps');
  return <LoginScreen />;
}
