import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { UsersView } from '@/components/apps/users-view';
import { endUsers, findApp } from '@/lib/mock-data';

export const metadata: Metadata = { title: 'Users' };

export default async function UsersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = findApp(id);
  if (!entry) notFound();
  // TODO(T5.3): fetch end users for entry.app.id from the admin API, paginated.
  return <UsersView users={endUsers} />;
}
