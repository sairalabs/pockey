import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { verifyMessage, type Hex } from 'viem';

const API_LOG = path.join(import.meta.dirname, '..', '.e2e', 'api.log');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The API runs with the console mailer, so the code is in its log. */
async function waitForOtp(email: string, timeoutMs = 20_000): Promise<string> {
  const pattern = new RegExp(`to=${escapeRegExp(email)} subject="(\\d{6}) is your`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = await readFile(API_LOG, 'utf8').catch(() => '');
    const code = pattern.exec(log)?.[1];
    if (code) return code;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No OTP for ${email} in ${API_LOG}`);
}

function logEntry(page: Page, label: string, ok: boolean) {
  return page
    .locator(`[data-testid="log-entry"][data-label="${label}"][data-ok="${String(ok)}"]`)
    .first();
}

const embed = (page: Page) => page.frameLocator('iframe[title="Pocketkey"]');

test('email login, embedded wallets, signature, rejection, reload and logout', async ({ page }) => {
  const email = `e2e-${Date.now()}@pocketkey.local`;

  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Signed out');

  // Login through the embed iframe.
  await page.getByTestId('login').click();
  await embed(page).getByTestId('pk-email-input').fill(email);
  await embed(page).getByTestId('pk-email-continue').click();
  const code = await waitForOtp(email);
  await embed(page).getByTestId('pk-otp-0').click();
  await page.keyboard.type(code);

  await expect(page.getByTestId('status')).toHaveText('Signed in');
  await expect(page.locator('iframe[title="Pocketkey"]')).toHaveCSS('visibility', 'hidden');
  await expect(page.getByTestId('user-identity')).toContainText(email);

  const evmAddress = (await page.getByTestId('evm-address').textContent()) ?? '';
  expect(evmAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  await expect(page.getByTestId('solana-address')).toHaveText(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

  // Sign a message: the embed asks for confirmation, the host gets a valid signature.
  await page.getByTestId('sign-evm').click();
  await expect(embed(page).getByTestId('pk-confirm-approve')).toBeVisible();
  await expect(embed(page).getByText('gm from the Pocketkey playground')).toBeVisible();
  await embed(page).getByTestId('pk-confirm-approve').click();

  const signed = logEntry(page, 'signMessage evm', true);
  await expect(signed).toBeVisible();
  const { signature } = JSON.parse((await signed.locator('pre').textContent()) ?? '{}') as {
    signature: Hex;
  };
  expect(
    await verifyMessage({
      address: evmAddress as Hex,
      message: 'gm from the Pocketkey playground',
      signature,
    }),
  ).toBe(true);

  // Cancel is a rejection the host can tell apart.
  await page.getByTestId('sign-evm').click();
  await embed(page).getByTestId('pk-confirm-cancel').click();
  await expect(logEntry(page, 'signMessage evm', false)).toContainText('user_rejected');

  // The session lives in the iframe and survives a reload of the host page.
  const userId = await page.getByTestId('user-id').textContent();
  await page.reload();
  await expect(page.getByTestId('status')).toHaveText('Signed in');
  await expect(page.getByTestId('user-id')).toHaveText(userId ?? '');

  await page.getByTestId('logout').click();
  await expect(page.getByTestId('status')).toHaveText('Signed out');
});

test('the EIP-1193 provider answers eth_chainId for the first configured chain', async ({
  page,
}) => {
  const email = `e2e-1193-${Date.now()}@pocketkey.local`;
  await page.goto('/');
  await page.getByTestId('login').click();
  await embed(page).getByTestId('pk-email-input').fill(email);
  await embed(page).getByTestId('pk-email-continue').click();
  const code = await waitForOtp(email);
  await embed(page).getByTestId('pk-otp-0').click();
  await page.keyboard.type(code);
  await expect(page.getByTestId('status')).toHaveText('Signed in');

  await page.getByTestId('eip1193-chain').click();
  await expect(logEntry(page, 'eth_chainId', true)).toContainText('"0x14a34"');
});
