import { ConsoleMailer, type Mailer, MemoryMailer, ResendMailer } from '@pocketkey/mailer';
import type { ParsedEnv } from '../env.js';

let cached: Mailer | undefined;

export function getMailer(config: ParsedEnv): Mailer {
  if (cached) return cached;
  switch (config.MAILER) {
    case 'memory':
      cached = new MemoryMailer();
      break;
    case 'console':
      cached = new ConsoleMailer();
      break;
    case 'resend':
      if (!config.RESEND_API_KEY) throw new Error('RESEND_API_KEY missing');
      cached = new ResendMailer({ apiKey: config.RESEND_API_KEY, from: config.MAIL_FROM });
      break;
  }
  return cached;
}
