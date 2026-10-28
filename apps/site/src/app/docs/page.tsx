import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocView } from '@/components/doc-view';
import { findDoc } from '@/lib/doc-list';

const doc = findDoc('');

export const metadata: Metadata = {
  title: 'Documentation',
  description: doc?.summary,
};

export default function DocsIndex() {
  if (!doc) notFound();
  return <DocView doc={doc} />;
}
