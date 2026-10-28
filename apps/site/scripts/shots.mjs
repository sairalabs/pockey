/**
 * Screenshots of the real modal for the landing page.
 *
 * The embed ships a preview route that renders every screen with mock data and
 * no network, so these are the components users see, not a mockup. Start the
 * embed first, then run this:
 *
 *   pnpm --filter @pockey/embed dev
 *   pnpm --filter @pockey/site shots
 *
 * Only the panel is photographed, on a transparent background, so the page can
 * light it the way it likes instead of inheriting the preview's own stage.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const EMBED = process.env.EMBED_URL ?? 'http://localhost:5174';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'shots');

/** The preview card label, the file it is written to, and the skin to wear. */
const SHOTS = [
  { label: 'Login', file: 'login.png' },
  { label: 'Email code', file: 'email-code.png' },
  { label: 'Sign message', file: 'sign-message.png' },
  { label: 'Confirm transaction', file: 'transaction.png' },
  /* The same login screen, dressed three other ways. The landing page flips
     between them, so an app with its own brand can see itself in it. */
  { label: 'Login', file: 'skin-light.png', theme: 'Light', accent: '#D2042D', radius: 'Round' },
  { label: 'Login', file: 'skin-green.png', accent: '#12A594', radius: 'Pill' },
  { label: 'Login', file: 'skin-sharp.png', theme: 'Light', accent: '#0B5FFF', radius: 'Sharp' },
];

/* The preview frames each screen in a stage with a blurred host page behind it.
   That is the gallery's furniture, not the product. */
const STRIP = `
  html, body, #root, #root > * { background: transparent !important; }
  .pk-preview-stage { background: transparent !important; box-shadow: none !important; }
  .pk-preview-stage > *:not(:last-child) { display: none !important; }
`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1480, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});
const page = await context.newPage();

await page.goto(`${EMBED}/?preview=1`, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: STRIP });

// The development feedback toolbar floats over the page. It is not part of the
// product and has no place in a screenshot of it.
await page.evaluate(() => {
  document.querySelectorAll('body > *:not(#root)').forEach((node) => {
    node.remove();
  });
});

let skin = '';
await mkdir(OUT, { recursive: true });

for (const shot of SHOTS) {
  const wanted = `${shot.theme ?? 'Dark'}|${shot.accent ?? ''}|${shot.radius ?? 'Soft'}`;
  if (wanted !== skin) {
    await page.getByRole('button', { name: shot.theme ?? 'Dark', exact: true }).click();
    await page.getByRole('button', { name: shot.radius ?? 'Soft', exact: true }).click();
    const hex = page.getByLabel('Accent hex value');
    await hex.fill(shot.accent ?? '#4132EC');
    await hex.press('Enter');
    // The picker waits for the typing to settle before repainting every screen.
    await page.waitForTimeout(900);
    skin = wanted;
  }

  const card = page.locator('section', {
    has: page.getByRole('heading', { level: 2, name: shot.label, exact: true }),
  });
  const panel = card.locator('[data-testid="pk-dialog"]').first();
  await panel.waitFor({ state: 'visible' });
  await panel.screenshot({
    path: path.join(OUT, shot.file),
    animations: 'disabled',
    omitBackground: true,
  });
  process.stdout.write(`${shot.file}\n`);
}

await browser.close();
