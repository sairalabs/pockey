'use client';

import { useState, type SyntheticEvent } from 'react';
import { Check } from './icons';
import { site } from '@/lib/site';

type State = 'idle' | 'sending' | 'done' | 'error' | 'unavailable';

/**
 * One field, one address, no account. If the server has no mailer configured it
 * says so and the form falls back to an ordinary email link, which is the whole
 * point of the exercise anyway: counting how many people ask.
 */
export function Waitlist() {
  const [state, setState] = useState<State>('idle');
  const [email, setEmail] = useState('');

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'sending' || state === 'done') return;
    void send(new FormData(event.currentTarget));
  }

  async function send(form: FormData) {
    setState('sending');
    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, company: form.get('company') ?? '' }),
      });
      if (response.ok) {
        setState('done');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setState(body.error === 'not_configured' ? 'unavailable' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <div className="flex items-center gap-3 rounded-control bg-surface-2 px-5 py-4 text-[14px] text-fg">
        <Check size={18} className="shrink-0 text-fg" />
        Noted. You will hear back only if this gets built.
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="waitlist-email" className="sr-only">
          Email address
        </label>
        <input
          id="waitlist-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          className="w-full rounded-control bg-surface-2 px-4 py-3 text-[14px] text-fg placeholder:text-fg-3 transition-colors hover:bg-surface-3 focus:bg-surface-3 focus:outline-none focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
        />
        {/* Left empty by a person, filled by a bot. */}
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
        />
        <button
          type="submit"
          disabled={state === 'sending'}
          className="shrink-0 rounded-control bg-white px-5 py-3 text-[14px] font-medium text-black transition-transform duration-150 active:scale-[0.96] disabled:opacity-60"
        >
          {state === 'sending' ? 'Sending' : 'Tell me when'}
        </button>
      </form>

      <p aria-live="polite" className="mt-3 text-[13px] text-fg-3">
        {state === 'error' ? (
          <span className="text-fg-2">
            That did not go through. Write to{' '}
            <a href={`mailto:${site.contact}`} className="text-fg underline underline-offset-2">
              {site.contact}
            </a>{' '}
            instead.
          </span>
        ) : state === 'unavailable' ? (
          <span className="text-fg-2">
            No list yet. Write to{' '}
            <a href={`mailto:${site.contact}`} className="text-fg underline underline-offset-2">
              {site.contact}
            </a>{' '}
            and it counts the same.
          </span>
        ) : (
          'Your address, nothing else. No newsletter.'
        )}
      </p>
    </div>
  );
}
