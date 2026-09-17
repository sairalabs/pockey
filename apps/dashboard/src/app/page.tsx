import { redirect } from 'next/navigation';
import { fetchSession, tryFetch } from '@/lib/api.server';

export const dynamic = 'force-dynamic';

export default async function IndexPage() {
  const session = await tryFetch(fetchSession);
  redirect(session.ok ? '/apps' : '/login');
}
