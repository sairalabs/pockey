import { newId, usageEvents, usageMonthly } from '@pockey/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { aggregateUsage, monthKey } from '../src/services/usage.js';
import { db, env, loginWithEmail, SEED, seedDb } from './helpers.js';

beforeAll(async () => {
  await seedDb();
});

describe('usage aggregation (T2.5)', () => {
  it('folds events into monthly totals and is idempotent', async () => {
    const alice = (await loginWithEmail('usage-a@test.dev')).body;
    await loginWithEmail('usage-a@test.dev'); // same user, same month: still one active user
    await loginWithEmail('usage-b@test.dev');

    const now = new Date();
    await db()
      .insert(usageEvents)
      .values([
        { id: newId('evt'), appId: SEED.app.id, endUserId: alice.user.id, type: 'tx.signed' },
        { id: newId('evt'), appId: SEED.app.id, endUserId: alice.user.id, type: 'tx.signed' },
        // Sums beyond 2^63 must not overflow.
        {
          id: newId('evt'),
          appId: SEED.app.id,
          type: 'tx.sponsored',
          amount: '9000000000000000000',
          meta: { chain: 'evm' },
        },
        {
          id: newId('evt'),
          appId: SEED.app.id,
          type: 'tx.sponsored',
          amount: '9000000000000000000',
          meta: { chain: 'evm' },
        },
        {
          id: newId('evt'),
          appId: SEED.app.id,
          type: 'tx.sponsored',
          amount: '5000',
          meta: { chain: 'solana' },
        },
      ]);

    await aggregateUsage(db(), now);
    await aggregateUsage(db(), now);

    const rows = await db().select().from(usageMonthly).where(eq(usageMonthly.appId, SEED.app.id));
    const current = rows.find((row) => row.month === monthKey(now));
    expect(rows.filter((row) => row.month === monthKey(now))).toHaveLength(1);
    expect(current).toMatchObject({
      activeUsers: 2,
      walletsCreated: 4,
      txSigned: 2,
      gasSponsoredWei: '18000000000000000000',
      gasSponsoredLamports: '5000',
    });
  });

  it('attributes an event to the month it happened in', async () => {
    const lastMonth = new Date();
    lastMonth.setUTCDate(1);
    lastMonth.setUTCHours(0, 0, 0, 0);
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    const lateInMonth = new Date(lastMonth.getTime());
    lateInMonth.setUTCDate(28);

    await db()
      .insert(usageEvents)
      .values({
        id: newId('evt'),
        appId: SEED.app.id,
        type: 'session.signed',
        createdAt: lateInMonth,
      });

    const { months } = await aggregateUsage(db());
    expect(months).toContain(monthKey(lastMonth));
    const previous = await db().query.usageMonthly.findFirst({
      where: (table, { and: both, eq: same }) =>
        both(same(table.appId, SEED.app.id), same(table.month, monthKey(lastMonth))),
    });
    expect(previous?.sessionSigned).toBe(1);
  });

  it('runs from the scheduled handler', async () => {
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException: () => undefined,
    } as unknown as ExecutionContext;
    await worker.scheduled(
      {
        cron: '0 * * * *',
        scheduledTime: Date.now(),
        noRetry: () => undefined,
      },
      env,
      ctx,
    );
    await Promise.all(pending);
    expect(pending).toHaveLength(1);
  });
});
