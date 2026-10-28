import type { Metadata } from 'next';
import { host, legal } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What this site collects, which is close to nothing, and what happens to it.',
  robots: { index: true, follow: true },
};

export default function Privacy() {
  return (
    <>
      <h1>Privacy</h1>
      <p>
        This site has no accounts, no analytics, no advertising and no tracking of any kind. It sets
        no cookies, which is why it asks you about none. Fonts are served from this domain, not from
        a third party.
      </p>

      <h2 id="controller">Who is responsible</h2>
      <p>
        The publisher named in the <a href="/legal/notice">legal notice</a> is the controller for
        the data described here. Write to <a href={`mailto:${legal.email}`}>{legal.email}</a> about
        any of it.
      </p>
      <p>
        This concerns this website only. Anyone who runs the Pockey software is the controller for
        their own users, and the publisher has no access to those deployments.
      </p>

      <h2 id="collected">What is collected</h2>
      <ul>
        <li>
          <strong>Server logs.</strong> The host records the usual technical data for each request,
          including the IP address, the date, the page requested and the browser identification. The
          purpose is to serve the site and to detect abuse. The legal basis is the legitimate
          interest in keeping the site available and secure.
        </li>
        <li>
          <strong>Your email address, only if you type it in.</strong> The hosted version form sends
          one address to one inbox so the publisher can count how many people want it. Nothing else
          is asked and nothing is stored in a database here. The legal basis is your consent, given
          by submitting the form.
        </li>
      </ul>

      <h2 id="recipients">Who sees it</h2>
      <ul>
        <li>{host.name}, as the host, for serving the site and keeping its logs.</li>
        <li>
          Resend, as the email provider, for delivering the message that carries your address.
        </li>
      </ul>
      <p>
        Both are established in the United States. Transfers rely on the European Commission’s
        standard contractual clauses. Nothing is sold, rented or passed to anyone else.
      </p>

      <h2 id="retention">How long</h2>
      <ul>
        <li>Server logs: kept by the host for its own retention period, a few weeks at most.</li>
        <li>
          An address sent through the form: kept in the publisher’s mailbox until the question of a
          hosted version is settled, and at most two years from the day you sent it.
        </li>
      </ul>

      <h2 id="rights">Your rights</h2>
      <p>
        You may ask for access to your data, for it to be corrected or erased, for its processing to
        be restricted, for it in a portable form, and you may object to processing or withdraw a
        consent you gave. One email to <a href={`mailto:${legal.email}`}>{legal.email}</a> is
        enough, and an answer is owed within one month.
      </p>
      <p>
        If the answer does not satisfy you, you may complain to the CNIL, the French data protection
        authority, at{' '}
        <a href="https://www.cnil.fr" target="_blank" rel="noreferrer noopener">
          cnil.fr
        </a>
        .
      </p>

      <h2 id="changes">Changes</h2>
      <p>
        If this page changes, the new version replaces this one at the same address. There is no
        mailing list to notify, by design.
      </p>
    </>
  );
}
