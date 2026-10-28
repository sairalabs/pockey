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
        No accounts, no analytics, no advertising, no tracking. No cookies either, which is why this
        site asks you about none. Fonts are served from this domain.
      </p>

      <h2 id="controller">Who is responsible</h2>
      <p>
        The publisher named in the <a href="/legal/notice">legal notice</a> is the controller. Write
        to <a href={`mailto:${legal.email}`}>{legal.email}</a> about any of it.
      </p>
      <p>
        This page covers this website only. Anyone who runs the Pockey software is the controller
        for their own users, and the publisher has no access to those deployments.
      </p>

      <h2 id="collected">What is collected</h2>
      <ul>
        <li>
          <strong>Server logs.</strong> The host records the IP address, the date, the page and the
          browser for each request, to serve the site and detect abuse. Legal basis: legitimate
          interest.
        </li>
        <li>
          <strong>Your email address, if you type it in.</strong> The hosted version form sends one
          address to one inbox, so the publisher can count who wants it. Nothing is stored in a
          database here. Legal basis: your consent.
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
        Both are in the United States, under the European Commission’s standard contractual clauses.
        Nothing is sold or passed to anyone else.
      </p>

      <h2 id="retention">How long</h2>
      <ul>
        <li>Server logs: the host’s own retention period, a few weeks at most.</li>
        <li>An address sent through the form: two years at most.</li>
      </ul>

      <h2 id="rights">Your rights</h2>
      <p>
        You can ask for access, correction, erasure, restriction or portability, and you can object
        or withdraw your consent. One email to <a href={`mailto:${legal.email}`}>{legal.email}</a>{' '}
        is enough, and an answer is owed within one month.
      </p>
      <p>
        If it does not satisfy you, you can complain to the CNIL, the French data protection
        authority, at{' '}
        <a href="https://www.cnil.fr" target="_blank" rel="noreferrer noopener">
          cnil.fr
        </a>
        .
      </p>

      <h2 id="changes">Changes</h2>
      <p>If this page changes, the new version replaces this one at the same address.</p>
    </>
  );
}
