import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { KeysView } from '@/components/apps/keys-view';
import { findApp } from '@/lib/mock-data';

export const metadata: Metadata = { title: 'API keys' };

export default async function KeysPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = findApp(id);
  if (!entry) notFound();
  return <KeysView app={entry} />;
}
