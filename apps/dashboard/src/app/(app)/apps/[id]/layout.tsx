import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppNav } from '@/components/shell/app-nav';
import { findApp } from '@/lib/mock-data';

export default async function AppDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = findApp(id);
  if (!entry) notFound();

  return (
    <>
      <AppNav appId={entry.app.id} />
      {children}
    </>
  );
}
