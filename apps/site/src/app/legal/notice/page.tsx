import type { Metadata } from 'next';
import { host, legal, site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Legal notice',
  description: 'Who publishes this site, who hosts it, and under which licence the software is.',
  robots: { index: true, follow: true },
};

/** A value the operator has to set in the environment before going live. */
function Value({ children }: { children: string }) {
  if (children) return <>{children}</>;
  return <span className="text-fg-3">to be set</span>;
}

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
        <li>
          Publisher: <Value>{legal.publisher}</Value>
        </li>
        <li>
          Legal form: <Value>{legal.status}</Value>
        </li>
        <li>
          Address: <Value>{legal.address}</Value>
        </li>
        <li>
          Registration: <Value>{legal.registration}</Value>
        </li>
        <li>
          Publication director: <Value>{legal.director}</Value>
        </li>
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
        The software is provided as is, without warranty of any kind, express or implied. The
        publisher operates no service on your behalf: anyone running Pockey runs it on their own
        infrastructure, under their own responsibility, and is the data controller for their own
        users.
      </p>

      <h2 id="content">Content of this site</h2>
      <p>
        The text, the layout and the marks on this site belong to the publisher. The documentation
        pages reproduce files from the repository and are covered by the MIT licence like the rest
        of it. The Pockey name and logo may not be used to suggest an endorsement of a fork.
      </p>

      <h2 id="liability">Liability</h2>
      <p>
        The publisher does its best to keep this site accurate but gives no guarantee that it is
        complete or current, and is not liable for any direct or indirect damage arising from its
        use or from the use of the software. External links are given for convenience and the
        publisher is not responsible for what they lead to.
      </p>

      <h2 id="law">Applicable law</h2>
      <p>
        This notice is governed by French law. Any dispute relating to this site falls to the courts
        with jurisdiction at the publisher’s address, subject to the mandatory rules that protect
        consumers.
      </p>

      <h2 id="privacy">Personal data</h2>
      <p>
        How this site handles personal data is set out in the <a href="/legal/privacy">privacy</a>{' '}
        page.
      </p>
    </>
  );
}
