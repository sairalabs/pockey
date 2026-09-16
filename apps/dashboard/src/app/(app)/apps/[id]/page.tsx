import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HomeView } from '@/components/apps/home-view';
import { findApp } from '@/lib/mock-data';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  return { title: findApp(id)?.app.name ?? 'App' };
}

export default async function AppHomePage({ params }: { params: Params }) {
  const { id } = await params;
  const entry = findApp(id);
  if (!entry) notFound();
  return <HomeView app={entry} />;
}
