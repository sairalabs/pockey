import type { Metadata } from 'next';
import { AppsList } from '@/components/apps/apps-list';
import { apps } from '@/lib/mock-data';

export const metadata: Metadata = { title: 'Apps' };

export default function AppsPage() {
  // TODO(T5.1): fetch the developer's apps from the admin API.
  return <AppsList initial={apps} />;
}
