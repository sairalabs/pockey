/**
 * Screenshots of the real modal for the landing page.
 *
 * The embed ships a preview route that renders every screen with mock data and
 * no network, so these are the components users see, not a mockup. Start the
 * embed first, then run this:
 *
 *   pnpm --filter @pockey/embed dev
 *   pnpm --filter @pockey/site shots
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const EMBED = process.env.EMBED_URL ?? 'http://localhost:5174';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'shots');

/** The preview card label, and the file it is written to. */
const SHOTS = [
  { label: 'Login', file: 'login.png' },
  { label: 'Email code', file: 'email-code.png' },
  { label: 'Sign message', file: 'sign-message.png' },
  { label: 'Confirm transaction', file: 'transaction.png' },
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1480, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});
const page = await context.newPage();

await page.goto(`${EMBED}/?preview=1`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Dark' }).click();

// The development feedback toolbar floats over the page. It is not part of the
// product and has no place in a screenshot of it.
await page.evaluate(() => {
  document.querySelectorAll('body > *:not(#root)').forEach((node) => {
    node.remove();
  });
});
await page.waitForTimeout(400);

await mkdir(OUT, { recursive: true });

for (const shot of SHOTS) {
  const card = page.locator('section', {
    has: page.getByRole('heading', { level: 2, name: shot.label, exact: true }),
  });
  const stage = card.locator('.pk-preview-stage');
  await stage.first().waitFor({ state: 'visible' });
  await stage.first().screenshot({ path: path.join(OUT, shot.file), animations: 'disabled' });
  process.stdout.write(`${shot.file}\n`);
}

await browser.close();
