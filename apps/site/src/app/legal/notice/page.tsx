import type { Metadata } from 'next';
import { host, legal, site } from '@/lib/site';

const DESCRIPTION =
  'Who publishes this site, who hosts it, and under which licence the software is.';

export const metadata: Metadata = {
  title: 'Legal notice',
  description: DESCRIPTION,
  alternates: { canonical: '/legal/notice' },
  openGraph: {
    type: 'article',
    siteName: site.name,
    title: `Legal notice - ${site.name}`,
    description: DESCRIPTION,
    url: new URL('/legal/notice', site.url).toString(),
    locale: 'en',
  },
};

export default function LegalNotice() {
  return (
    <>
      <h1>Legal notice</h1>
      <p>
        Published in accordance with article 6 III of the French law 2004-575 of 21 June 2004 on
        confidence in the digital economy.
      </p>

      <h2 id="publisher">Publisher</h2>
      <ul>
        <li>Publisher: {legal.publisher}</li>
        <li>Legal form: {legal.status}</li>
        <li>Registered office: {legal.address}</li>
        <li>Registration: {legal.registration}</li>
        <li>SIRET: {legal.siret}</li>
        <li>VAT: {legal.vat}</li>
        <li>Publication director: {legal.director}</li>
        <li>
          Contact: <a href={`mailto:${legal.email}`}>{legal.email}</a>
        </li>
      </ul>

      <h2 id="host">Host</h2>
      <p>
        This site is hosted by {host.name}, {host.address} (
        <a href={host.url} target="_blank" rel="noreferrer noopener">
          {host.url}
        </a>
        ).
      </p>

      <h2 id="software">The software</h2>
      <p>
        Pockey is free software released under the MIT licence. The full terms are in the{' '}
        <a href={`${site.repo}/blob/main/LICENSE`} target="_blank" rel="noreferrer noopener">
          LICENSE
        </a>{' '}
        file of the repository and they govern any use of the code.
      </p>
      <p>
        The software is provided as is, without warranty of any kind. The publisher operates no
        service on your behalf: anyone running Pockey runs it under their own responsibility and is
        the data controller for their own users.
      </p>

      <h2 id="content">Content of this site</h2>
      <p>
        The text, the layout and the marks belong to the publisher. The documentation pages
        reproduce files from the repository and are covered by the MIT licence. The Pockey name and
        logo may not be used to suggest an endorsement of a fork.
      </p>

      <h2 id="liability">Liability</h2>
      <p>
        This site is kept accurate as far as possible, with no guarantee that it is complete or
        current, and the publisher is not liable for any damage arising from its use or from the use
        of the software. External links are given for convenience only.
      </p>

      <h2 id="law">Applicable law</h2>
      <p>
        French law applies. Any dispute falls to the courts with jurisdiction at the publisher’s
        address, subject to the mandatory rules that protect consumers.
      </p>

      <h2 id="privacy">Personal data</h2>
      <p>
        See the <a href="/legal/privacy">privacy</a> page.
      </p>
    </>
  );
}
