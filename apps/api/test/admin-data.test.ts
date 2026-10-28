import {
  endUserIdentities,
  endUsers,
  newId,
  sponsorBalances,
  usageEvents,
  usageMonthly,
} from '@pockey/db';
import {
  AdminEndUserList,
  AdminUsage,
  BillingPortalOutput,
  BillingSummary,
  FREE_MONTHLY_ACTIVE_WALLETS,
  PRICE_CENTS_PER_ACTIVE_WALLET,
  SponsorBalance,
  TopUpCheckoutOutput,
  type AdminApp,
} from '@pockey/types';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { adminRequest, createAdminApp, db, loginAsDeveloper, seedDb } from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
const threeDaysAgo = new Date(today.getTime() - 3 * DAY_MS);
const fortyDaysAgo = new Date(today.getTime() - 40 * DAY_MS);
const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const monthOf = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

let owner = '';
let metrics: AdminApp;

interface EventInput {
  type: 'wallet.created' | 'user.active' | 'tx.signed' | 'tx.sponsored' | 'session.signed';
  createdAt: Date;
  endUserId?: string;
  amount?: string;
  meta?: Record<string, unknown>;
}

async function insertEvents(appId: string, events: EventInput[]): Promise<void> {
  for (let index = 0; index < events.length; index += 12) {
    await db()
      .insert(usageEvents)
      .values(
        events.slice(index, index + 12).map((event) => ({
          id: newId('evt'),
          appId,
          type: event.type,
          createdAt: event.createdAt,
          endUserId: event.endUserId ?? null,
          amount: event.amount ?? null,
          meta: event.meta ?? null,
        })),
      );
  }
}

beforeAll(async () => {
  await seedDb();
  owner = await loginAsDeveloper('data.owner@test.dev');
  metrics = await createAdminApp(owner, { name: 'Metrics App' });

  await insertEvents(metrics.app.id, [
    { type: 'wallet.created', createdAt: today },
    { type: 'wallet.created', createdAt: today },
    { type: 'tx.signed', createdAt: today },
    { type: 'session.signed', createdAt: today },
    { type: 'user.active', createdAt: today, endUserId: 'usr_metrics000000000000001' },
    { type: 'user.active', createdAt: today, endUserId: 'usr_metrics000000000000002' },
    { type: 'tx.sponsored', createdAt: today, amount: '1000', meta: { chain: 'evm' } },
    { type: 'tx.sponsored', createdAt: today, amount: '500', meta: { chain: 'solana' } },
    { type: 'wallet.created', createdAt: threeDaysAgo },
    { type: 'wallet.created', createdAt: fortyDaysAgo },
  ]);

  // Two end users with identities, for the login method breakdown.
  for (const type of ['email', 'passkey'] as const) {
    const endUserId = newId('usr');
    await db().insert(endUsers).values({ id: endUserId, appId: metrics.app.id });
    await db()
      .insert(endUserIdentities)
      .values({
        id: newId('idn'),
        endUserId,
        appId: metrics.app.id,
        type,
        identifier: `${type}@metrics.test`,
      });
  }
});

describe('usage graphs', () => {
  it('fills 7 daily points, zeros included', async () => {
    const res = await adminRequest(`/admin/apps/${metrics.app.id}/usage?range=7d`, owner);
    expect(res.status, await res.clone().text()).toBe(200);
    const usage = AdminUsage.parse(await res.json());

    expect(usage.range).toBe('7d');
    expect(usage.points).toHaveLength(7);
    expect(usage.points.at(-1)?.date).toBe(dayOf(today));
    expect(usage.points[0]?.date).toBe(dayOf(new Date(today.getTime() - 6 * DAY_MS)));

    const last = usage.points.at(-1);
    expect(last?.walletsCreated).toBe(2);
    expect(last?.txSigned).toBe(1);
    expect(last?.sessionSigned).toBe(1);
    expect(last?.activeUsers).toBe(2);
    expect(last?.gasSponsoredWei).toBe('1000');
    expect(last?.gasSponsoredLamports).toBe('500');

    const earlier = usage.points.find((point) => point.date === dayOf(threeDaysAgo));
    expect(earlier?.walletsCreated).toBe(1);

    const untouched = usage.points.find(
      (point) => point.date === dayOf(new Date(today.getTime() - 5 * DAY_MS)),
    );
    expect(untouched).toEqual({
      date: dayOf(new Date(today.getTime() - 5 * DAY_MS)),
      activeUsers: 0,
      walletsCreated: 0,
      txSigned: 0,
      sessionSigned: 0,
      gasSponsoredWei: '0',
      gasSponsoredLamports: '0',
    });
  });

  it('fills 30 daily points and leaves older events out', async () => {
    const res = await adminRequest(`/admin/apps/${metrics.app.id}/usage?range=30d`, owner);
    const usage = AdminUsage.parse(await res.json());
    expect(usage.points).toHaveLength(30);
    const created = usage.points.reduce((total, point) => total + point.walletsCreated, 0);
    expect(created).toBe(3);
    expect(usage.points.some((point) => point.date === dayOf(fortyDaysAgo))).toBe(false);
  });

  it('gives 12 monthly points, past months stored and the current one live', async () => {
    const past = monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)));
    await db().insert(usageMonthly).values({
      appId: metrics.app.id,
      month: past,
      activeUsers: 42,
      walletsCreated: 7,
      txSigned: 3,
      sessionSigned: 1,
      gasSponsoredWei: '123',
      gasSponsoredLamports: '456',
    });

    const res = await adminRequest(`/admin/apps/${metrics.app.id}/usage?range=12m`, owner);
    const usage = AdminUsage.parse(await res.json());
    expect(usage.points).toHaveLength(12);
    expect(usage.points.at(-1)?.date).toBe(monthOf(today));
    expect(usage.points.find((point) => point.date === past)).toEqual({
      date: past,
      activeUsers: 42,
      walletsCreated: 7,
      txSigned: 3,
      sessionSigned: 1,
      gasSponsoredWei: '123',
      gasSponsoredLamports: '456',
    });

    // The current month is recomputed from events, not read from the cron table.
    const current = usage.points.at(-1);
    const sameMonth = threeDaysAgo.getUTCMonth() === today.getUTCMonth() ? 1 : 0;
    expect(current?.walletsCreated).toBe(2 + sameMonth);
    expect(current?.activeUsers).toBe(2);
  });

  it('reports the current month totals and the login method breakdown', async () => {
    const res = await adminRequest(`/admin/apps/${metrics.app.id}/usage`, owner);
    const usage = AdminUsage.parse(await res.json());
    // The default range is 30d.
    expect(usage.range).toBe('30d');
    expect(usage.month.month).toBe(monthOf(today));
    expect(usage.month.activeUsers).toBe(2);
    expect(usage.month.gasSponsoredWei).toBe('1000');
    expect(usage.month.gasSponsoredLamports).toBe('500');

    expect(usage.loginMethods).toEqual([
      { method: 'email', users: 1 },
      { method: 'google', users: 0 },
      { method: 'apple', users: 0 },
      { method: 'passkey', users: 1 },
      { method: 'wallet', users: 0 },
    ]);
  });

  it('refuses an unknown range', async () => {
    const res = await adminRequest(`/admin/apps/${metrics.app.id}/usage?range=1y`, owner);
    expect(res.status).toBe(400);
  });
});

describe('end users', () => {
  it('paginates with a cursor and reports the total', async () => {
    const app = await createAdminApp(owner, { name: 'Users App' });
    for (let index = 0; index < 5; index++) {
      await db()
        .insert(endUsers)
        .values({ id: newId('usr'), appId: app.app.id });
    }

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : '?limit=2';
      const res = await adminRequest(`/admin/apps/${app.app.id}/users${query}`, owner);
      expect(res.status, await res.clone().text()).toBe(200);
      const page = AdminEndUserList.parse(await res.json());
      expect(page.total).toBe(5);
      for (const user of page.users) seen.add(user.id);
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(seen.size).toBe(5);
    expect(pages).toBe(3);
  });

  it('refuses a malformed cursor', async () => {
    const res = await adminRequest(`/admin/apps/${metrics.app.id}/users?cursor=nope`, owner);
    expect(res.status).toBe(400);
  });
});

describe('sponsoring', () => {
  it('reads the balance and opens a top-up checkout', async () => {
    const app = await createAdminApp(owner, {
      name: 'Sponsored App',
      config: { gasSponsoring: { evm: false, solana: true, solanaDailyCapLamports: '5000' } },
    });
    await db()
      .update(sponsorBalances)
      .set({ balanceCents: 2500 })
      .where(eq(sponsorBalances.appId, app.app.id));

    const balance = await adminRequest(`/admin/apps/${app.app.id}/sponsoring`, owner);
    expect(balance.status).toBe(200);
    expect(SponsorBalance.parse(await balance.json())).toEqual({
      balanceCents: 2500,
      solanaSpentTodayLamports: '0',
      solanaDailyCapLamports: '5000',
    });

    const checkout = await adminRequest(`/admin/apps/${app.app.id}/sponsoring/checkout`, owner, {
      method: 'POST',
      body: {
        amountCents: 2000,
        successUrl: 'https://dash.example/ok',
        cancelUrl: 'https://dash.example/ko',
      },
    });
    expect(checkout.status, await checkout.clone().text()).toBe(201);
    expect(TopUpCheckoutOutput.parse(await checkout.json()).checkoutId).toBeTruthy();
  });

  it('refuses a top-up below the minimum', async () => {
    const res = await adminRequest(`/admin/apps/${metrics.app.id}/sponsoring/checkout`, owner, {
      method: 'POST',
      body: {
        amountCents: 100,
        successUrl: 'https://dash.example/ok',
        cancelUrl: 'https://dash.example/ko',
      },
    });
    expect(res.status).toBe(400);
  });
});

describe('billing', () => {
  it('stays free under the included wallets and sums the sponsor balances', async () => {
    const res = await adminRequest('/admin/billing', owner);
    expect(res.status, await res.clone().text()).toBe(200);
    const summary = BillingSummary.parse(await res.json());

    expect(summary.plan).toBe('free');
    expect(summary.includedWallets).toBe(FREE_MONTHLY_ACTIVE_WALLETS);
    expect(summary.unitPriceCents).toBe(PRICE_CENTS_PER_ACTIVE_WALLET);
    expect(summary.activeWallets).toBe(2);
    expect(summary.estimatedCents).toBe(0);
    expect(summary.sponsorBalanceCents).toBe(2500);
    // the customer is created on demand, so the portal is offered as soon
    // as billing is configured on the server, before any customer exists.
    expect(summary.portalAvailable).toBe(true);
  });

  it('bills every active wallet above the free allowance', async () => {
    const heavy = await loginAsDeveloper('heavy@test.dev');
    const app = await createAdminApp(heavy, { name: 'Heavy App' });
    const over = 5;
    const events: EventInput[] = [];
    for (let index = 0; index < FREE_MONTHLY_ACTIVE_WALLETS + over; index++) {
      events.push({
        type: 'user.active',
        createdAt: today,
        endUserId: `usr_heavy${String(index).padStart(19, '0')}`,
      });
    }
    await insertEvents(app.app.id, events);

    const res = await adminRequest('/admin/billing', heavy);
    const summary = BillingSummary.parse(await res.json());
    expect(summary.activeWallets).toBe(FREE_MONTHLY_ACTIVE_WALLETS + over);
    expect(summary.plan).toBe('pay_as_you_go');
    expect(summary.estimatedCents).toBe(over * PRICE_CENTS_PER_ACTIVE_WALLET);
  });

  it('opens the billing portal, creating the Stripe customer on the way', async () => {
    const res = await adminRequest('/admin/billing/portal', owner);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(BillingPortalOutput.parse(await res.json()).url).toContain('/mock/billing-portal/');
  });
});
