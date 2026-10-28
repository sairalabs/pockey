import { docHeadings, renderDoc } from '@/lib/docs';
import type { DocPage } from '@/lib/doc-list';
import { site } from '@/lib/site';
import { ArrowUpRight } from './icons';

/**
 * One documentation page: the repository's markdown, its own headings beside
 * it, and a link to the file so a reader can correct it where it lives.
 */
export async function DocView({ doc }: { doc: DocPage }) {
  const [html, headings] = await Promise.all([renderDoc(doc), docHeadings(doc)]);

  return (
    <div className="flex gap-12">
      <article className="min-w-0 flex-1">
        <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
        <a
          href={`${site.repo}/blob/main/${doc.file}`}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-14 inline-flex items-center gap-1.5 text-[13px] text-fg-3 transition-colors hover:text-fg"
        >
          Edit {doc.file} on GitHub
          <ArrowUpRight size={14} />
        </a>
      </article>

      {headings.length > 1 ? (
        <nav aria-label="On this page" className="hidden w-[200px] shrink-0 xl:block">
          <div className="sticky top-24">
            <p className="text-[13px] font-semibold text-fg">On this page</p>
            <ul className="mt-3 space-y-2">
              {headings.map((heading) => (
                <li key={heading.id}>
                  <a
                    href={`#${heading.id}`}
                    className="block text-[13px] leading-[1.45] text-fg-3 transition-colors hover:text-fg"
                  >
                    {heading.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
