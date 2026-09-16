import { describe, expect, it } from 'vitest';
import { MailerError, MemoryMailer, otpEmail, ResendMailer } from './index.js';

describe('MemoryMailer', () => {
  it('stores messages and finds the last one per recipient', async () => {
    const mailer = new MemoryMailer();
    await mailer.send({ to: 'a@b.co', subject: 'one', text: '1' });
    await mailer.send({ to: 'a@b.co', subject: 'two', text: '2' });
    expect(mailer.outbox).toHaveLength(2);
    expect(mailer.lastTo('a@b.co')?.subject).toBe('two');
    mailer.clear();
    expect(mailer.outbox).toHaveLength(0);
  });
});

describe('ResendMailer', () => {
  it('posts the expected payload', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      captured = { url: input instanceof Request ? input.url : input.toString(), init: init ?? {} };
      return new Response('{"id":"x"}', { status: 200 });
    };
    const mailer = new ResendMailer({
      apiKey: 're_test',
      from: 'Pocketkey <auth@pocketkey.dev>',
      fetch: fakeFetch,
    });
    await mailer.send(
      otpEmail({ to: 'a@b.co', code: '123456', appName: 'Playground', minutes: 10 }),
    );

    expect(captured?.url).toBe('https://api.resend.com/emails');
    const headers = new Headers(captured?.init.headers);
    expect(headers.get('Authorization')).toBe('Bearer re_test');
    const rawBody = captured?.init.body;
    const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as {
      to: string[];
      subject: string;
      text: string;
    };
    expect(body.to).toEqual(['a@b.co']);
    expect(body.subject).toBe('123456 is your Playground code');
    expect(body.text).toContain('expires in 10 minutes');
  });

  it('throws MailerError on a non 2xx response without leaking the key', async () => {
    const fakeFetch: typeof fetch = async () => new Response('invalid from', { status: 422 });
    const mailer = new ResendMailer({ apiKey: 're_secret', from: 'x@y.z', fetch: fakeFetch });
    const error = await mailer
      .send({ to: 'a@b.co', subject: 's', text: 't' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailerError);
    expect((error as MailerError).status).toBe(422);
    expect((error as MailerError).message).not.toContain('re_secret');
  });
});
