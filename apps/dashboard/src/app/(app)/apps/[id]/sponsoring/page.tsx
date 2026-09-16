import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SponsoringView } from '@/components/apps/sponsoring-view';
import { findApp } from '@/lib/mock-data';

export const metadata: Metadata = { title: 'Sponsoring' };

export default async function SponsoringPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = findApp(id);
  if (!entry) notFound();
  return <SponsoringView app={entry} />;
}
