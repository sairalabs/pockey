import { NextResponse } from 'next/server';

/**
 * The only route on this site. It forwards one address to one inbox through
 * Resend and keeps nothing: there is no database here, and a list of people who
 * asked about a product that may never exist is not worth storing.
 *
 * Without RESEND_API_KEY and WAITLIST_TO it answers `not_configured`, and the
 * form falls back to an ordinary email link.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request: Request) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.WAITLIST_TO;
  const from = process.env.WAITLIST_FROM ?? 'Pockey <noreply@pockey.xyz>';

  if (!key || !to) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  let body: { email?: unknown; company?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // The honeypot field is invisible, so anything in it came from a script.
  if (typeof body.company === 'string' && body.company.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (email.length > 254 || !EMAIL.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Pockey cloud: one more ask',
      text: `${email} asked to be told if a hosted Pockey happens.`,
      reply_to: email,
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: 'send_failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
