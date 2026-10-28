/**
 * Screenshot of the real developer dashboard for the landing page.
 *
 * It drives the local stack the same way the end to end suite does: the API
 * with the console mailer, which prints the login code to a log this script
 * reads. Start both first, then run this:
 *
 *   bash apps/api/scripts/e2e-server.sh
 *   pnpm --filter @pockey/dashboard dev -- --port 3801
 *   pnpm --filter @pockey/site shots:dashboard
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const DASHBOARD = process.env.DASHBOARD_URL ?? 'http://localhost:3801';
const EMAIL = process.env.DASHBOARD_EMAIL ?? 'dev@pockey.local';
const here = path.dirname(fileURLToPath(import.meta.url));
const LOG = process.env.API_LOG ?? path.join(here, '..', '..', 'playground', '.e2e', 'api.log');
const OUT = path.join(here, '..', 'public', 'shots');

/** The console mailer prints the code in the body of the message. */
async function lastCode() {
  const log = await readFile(LOG, 'utf8');
  const codes = log.match(/\b\d{6}\b/g);
  if (!codes?.length) throw new Error(`No login code in ${LOG}`);
  return codes[codes.length - 1];
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1360, height: 850 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});
const page = await context.newPage();

await page.goto(`${DASHBOARD}/login`, { waitUntil: 'networkidle' });
await page.getByLabel('Email').fill(EMAIL);
await page.getByRole('button', { name: /continue|sign in|send/i }).click();
await page.getByText('Check your email').waitFor();

// The code is written to the log as the API sends it, not before.
await page.waitForTimeout(1500);
await page.keyboard.type(await lastCode(), { delay: 60 });

await page.waitForURL(/\/apps/, { timeout: 20_000 });
await page
  .getByRole('link', { name: /playground/i })
  .first()
  .click();
await page.waitForURL(/\/apps\/[^/]+$/, { timeout: 20_000 });
await page.waitForLoadState('networkidle');

// The configuration pane holds the login methods and the chains an app offers,
// which is the screen that shows what the dashboard is for.
await page.getByRole('button', { name: 'Account' }).click();
await page.getByRole('menuitem', { name: 'Settings' }).click();
await page.getByRole('button', { name: 'Configuration', exact: true }).click();
await page.waitForTimeout(1200);

// Next's development indicator and the feedback toolbar are tooling, not the
// product, and they float over the page.
await page.evaluate(() => {
  document.querySelectorAll('nextjs-portal, body > *:not(#__next):not(div)').forEach((node) => {
    node.remove();
  });
  document.querySelectorAll('body > div').forEach((node) => {
    if (!node.querySelector('main, header, nav')) node.remove();
  });
});

await mkdir(OUT, { recursive: true });
await page.screenshot({ path: path.join(OUT, 'dashboard.png'), animations: 'disabled' });
process.stdout.write('dashboard.png\n');

await browser.close();
