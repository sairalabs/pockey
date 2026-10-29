import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocView } from '@/components/doc-view';
import { JsonLd } from '@/components/structured-data';
import { findDoc } from '@/lib/doc-list';
import { docGraph, docMetadata } from '@/lib/doc-meta';

const doc = findDoc('');

export const metadata: Metadata = doc ? docMetadata(doc) : {};

export default function DocsIndex() {
  if (!doc) notFound();
  return (
    <>
      <JsonLd data={docGraph(doc)} />
      <DocView doc={doc} />
    </>
  );
}
