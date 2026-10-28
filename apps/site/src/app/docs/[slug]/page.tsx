import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocView } from '@/components/doc-view';
import { DOCS, findDoc } from '@/lib/doc-list';

interface Params {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return DOCS.filter((doc) => doc.slug).map((doc) => ({ slug: doc.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const doc = findDoc(slug);
  return doc ? { title: doc.title, description: doc.summary } : {};
}

export default async function DocPageRoute({ params }: Params) {
  const { slug } = await params;
  const doc = findDoc(slug);
  if (!doc) notFound();
  return <DocView doc={doc} />;
}
