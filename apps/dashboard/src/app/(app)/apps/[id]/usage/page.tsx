import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { UsageView } from '@/components/apps/usage-view';
import { findApp } from '@/lib/mock-data';

export const metadata: Metadata = { title: 'Usage' };

export default async function UsagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = findApp(id);
  if (!entry) notFound();
  return <UsageView app={entry} />;
}
