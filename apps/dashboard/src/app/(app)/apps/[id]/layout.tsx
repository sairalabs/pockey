import type { ReactNode } from 'react';
import { LoginScreen } from '@/components/auth/login-screen';
import { AppNav } from '@/components/shell/app-nav';
import { loadApp } from '@/lib/api.server';

export default async function AppDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loaded = await loadApp(id);
  if (!loaded.ok) return <LoginScreen />;

  return (
    <>
      <AppNav appId={loaded.data.app.id} />
      {children}
    </>
  );
}
