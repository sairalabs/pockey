import { apps, developers, newId, newPublicAppId, usageEvents, type Db } from '@pocketkey/db';
import { createMockPayments, type MockPayments } from '@pocketkey/payments';
import { AdminSession, AppConfig, BillingPortalOutput, BillingSummary } from '@pocketkey/types';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAILY_CRON } from '../src/cron.js';
import { parseEnv, type Env } from '../src/env.js';
import worker from '../src/index.js';
import { setPaymentsForTests } from '../src/lib/sponsor.js';
import {
  billingConfigured,
  ensureBilling,
  meterActiveWallets,
  meterIdentifier,
  utcDayKey,
} from '../src/services/billing.js';
import {
  adminRequest,
  app as api,
  db,
  DASHBOARD_ORIGIN,
  env,
  loginAsDeveloper,
  SEED,
  seedDb,
} from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const noon = (daysBack: number): Date => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12) - daysBack * DAY_MS,
  );
};

let payments: MockPayments;

async function developerRow(id: string) {
  const row = await db().query.developers.findFirst({ where: eq(developers.id, id) });
  if (!row) throw new Error(`no developer ${id}`);
  return row;
}

async function activeUsers(database: Db, appId: string, at: Date, count: number): Promise<void> {
  await database.insert(usageEvents).values(
    Array.from({ length: count }, (_unused, index) => ({
      id: newId('evt'),
      appId,
      endUserId: `usr_${crypto.randomUUID().replaceAll('-', '')}${String(index)}`.slice(0, 28),
      type: 'user.active' as const,
      createdAt: at,
    })),
  );
}

/** A developer that already has a Stripe customer, with one app. */
async function billedDeveloper(customerId: string): Promise<{ id: string; appId: string }> {
  const id = newId('dev');
  const appId = newId('app');
  await db()
    .insert(developers)
    .values({ id, email: `${id}@test.dev`, name: 'Metered', stripeCustomerId: customerId });
  await db()
    .insert(apps)
    .values({
      id: appId,
      publicId: newPublicAppId(),
      developerId: id,
      name: 'Metered app',
      slug: appId.slice(4, 24),
      allowedOrigins: [],
      config: AppConfig.parse({}),
    });
  return { id, appId };
}

beforeAll(async () => {
  await seedDb();
  payments = createMockPayments({ baseUrl: 'http://localhost:8787' });
  setPaymentsForTests(payments);
});

afterAll(() => {
  setPaymentsForTests(undefined);
});

describe('Stripe customer and subscription (T5.4)', () => {
  it('creates the customer once, persists it and reuses it', async () => {
    const config = parseEnv(env);
    const before = await developerRow(SEED.developer.id);
    expect(before.stripeCustomerId).toBeNull();

    const customerId = await ensureBilling(db(), payments, before, config);
    expect(customerId).toMatch(/^cus_mock_/);
    expect((await developerRow(SEED.developer.id)).stripeCustomerId).toBe(customerId);

    // Same developer, now carrying the stored id: no second customer.
    const again = await ensureBilling(
      db(),
      payments,
      await developerRow(SEED.developer.id),
      config,
    );
    expect(again).toBe(customerId);
  });

  it('opens the billing portal and marks the developer as billable', async () => {
    const cookie = await loginAsDeveloper('portal@test.dev');

    const res = await adminRequest('/admin/billing/portal', cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    const portal = BillingPortalOutput.parse(await res.json());
    expect(portal.url).toContain('/mock/billing-portal/cus_mock_');
    expect(portal.url).toContain(encodeURIComponent(`${DASHBOARD_ORIGIN}/billing`));

    const session = await adminRequest('/admin/session', cookie);
    expect(AdminSession.parse(await session.json()).developer.billingReady).toBe(true);

    const summary = await adminRequest('/admin/billing', cookie);
    expect(BillingSummary.parse(await summary.json()).portalAvailable).toBe(true);
  });

  it('refuses the portal when the metered price is not configured', async () => {
    // Stripe selected but without STRIPE_ACTIVE_WALLET_PRICE_ID: the usage based
    // plan cannot be created, so the portal answers 400 instead of half working.
    const unconfigured: Env = {
      ...env,
      PAYMENTS: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_unconfigured',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_unconfigured',
    };
    expect(billingConfigured(parseEnv(unconfigured))).toBe(false);

    const cookie = await loginAsDeveloper('unconfigured@test.dev');
    const headers = { Origin: DASHBOARD_ORIGIN, Cookie: cookie };
    const res = await api.request('/admin/billing/portal', { headers }, unconfigured);
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('bad_request');
    expect(body.error.message).toContain('not configured');

    const summary = await api.request('/admin/billing', { headers }, unconfigured);
    expect(BillingSummary.parse(await summary.json()).portalAvailable).toBe(false);
  });
});

describe('nightly active wallet metering (T5.4, section 7.6)', () => {
  it('sends one event per developer, with the day value and identifier', async () => {
    const customerId = (await developerRow(SEED.developer.id)).stripeCustomerId ?? '';
    const day = noon(1);
    await activeUsers(db(), SEED.app.id, day, 3);
    // Today must not land in yesterday's report.
    await activeUsers(db(), SEED.app.id, noon(0), 2);

    const before = payments.meterEvents().length;
    const result = await meterActiveWallets(db(), payments, { date: day });
    expect(result).toEqual({
      day: utcDayKey(day),
      developers: 1,
      activeWallets: 3,
      failed: 0,
    });

    const sent = payments.meterEvents().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.customerId).toBe(customerId);
    expect(sent[0]?.event.identifier).toBe(meterIdentifier(SEED.developer.id, utcDayKey(day)));
    expect(sent[0]?.event.value).toBe(3);
  });

  it('is a no-op when run twice, and when the day is empty', async () => {
    const before = payments.meterEvents().length;
    // Same identifier: the provider deduplicates, nothing new is recorded.
    await meterActiveWallets(db(), payments, { date: noon(1) });
    expect(payments.meterEvents()).toHaveLength(before);

    const empty = await meterActiveWallets(db(), payments, {
      date: new Date(Date.UTC(2020, 0, 15)),
    });
    expect(empty).toMatchObject({ developers: 0, activeWallets: 0, failed: 0 });
    expect(payments.meterEvents()).toHaveLength(before);
  });

  it('ignores developers without a Stripe customer', async () => {
    const id = newId('dev');
    const appId = newId('app');
    await db()
      .insert(developers)
      .values({ id, email: `${id}@test.dev` });
    await db()
      .insert(apps)
      .values({
        id: appId,
        publicId: newPublicAppId(),
        developerId: id,
        name: 'Unbilled',
        slug: appId.slice(4, 24),
        allowedOrigins: [],
        config: AppConfig.parse({}),
      });
    const day = noon(5);
    await activeUsers(db(), appId, day, 4);

    const result = await meterActiveWallets(db(), payments, { date: day });
    expect(result).toMatchObject({ developers: 0, activeWallets: 0 });
  });

  it('reports the two previous days from the daily cron', async () => {
    const metered = await billedDeveloper('cus_mock_cron');
    await activeUsers(db(), metered.appId, noon(1), 2);
    await activeUsers(db(), metered.appId, noon(2), 5);

    const before = payments.meterEvents().length;
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (task: Promise<unknown>) => pending.push(task),
      passThroughOnException: () => undefined,
    } as unknown as ExecutionContext;
    await worker.scheduled(
      { cron: DAILY_CRON, scheduledTime: Date.now(), noRetry: () => undefined },
      env,
      ctx,
    );
    await Promise.all(pending);
    expect(pending).toHaveLength(1);

    const sent = payments.meterEvents().slice(before);
    const identifiers = sent.map((row) => row.event.identifier);
    expect(identifiers).toContain(meterIdentifier(metered.id, utcDayKey(noon(1))));
    expect(identifiers).toContain(meterIdentifier(metered.id, utcDayKey(noon(2))));
    expect(sent.every((row) => row.customerId === 'cus_mock_cron')).toBe(true);
    expect(sent.find((row) => row.event.identifier.endsWith(utcDayKey(noon(2))))?.event.value).toBe(
      5,
    );
  });
});
