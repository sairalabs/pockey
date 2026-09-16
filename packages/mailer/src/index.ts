/**
 * Mailer port (CLAUDE.md: every external service sits behind an interface in packages/).
 * The API only knows `Mailer`; Resend, console and memory are interchangeable.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Used to group sends in provider dashboards, never shown to the recipient. */
  tag?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class MailerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MailerError';
  }
}

/** Keeps every message in memory. Tests read `outbox` to fetch OTP codes. */
export class MemoryMailer implements Mailer {
  readonly outbox: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
  }

  lastTo(to: string): MailMessage | undefined {
    return [...this.outbox].reverse().find((m) => m.to === to);
  }

  clear(): void {
    this.outbox.length = 0;
  }
}

/** Local development: prints the message so the OTP shows in the wrangler logs. */
export class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    console.warn(`[mail] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }
}

export interface ResendMailerOptions {
  apiKey: string;
  from: string;
  /** Injected for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
}

/** Resend over plain fetch, no SDK, so it runs on Workers without extra weight. */
export class ResendMailer implements Mailer {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ResendMailerOptions) {
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis);
  }

  async send(message: MailMessage): Promise<void> {
    const body: Record<string, unknown> = {
      from: this.options.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    };
    if (message.html) body.html = message.html;
    if (message.tag) body.tags = [{ name: 'category', value: message.tag }];

    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Never echo the API key; the response body is provider text only.
      const detail = await res.text().catch(() => '');
      throw new MailerError(
        `Resend rejected the message (${res.status}): ${detail.slice(0, 200)}`,
        res.status,
      );
    }
  }
}

/** OTP email copy. Kept here so every mailer sends the same words. */
export function otpEmail(options: {
  to: string;
  code: string;
  appName: string;
  minutes: number;
}): MailMessage {
  const text = [
    `Your ${options.appName} sign-in code is ${options.code}.`,
    '',
    `It expires in ${options.minutes} minutes. If you did not try to sign in, you can ignore this email.`,
  ].join('\n');
  return {
    to: options.to,
    subject: `${options.code} is your ${options.appName} code`,
    text,
    tag: 'otp',
  };
}
