import {
  apiKeyPrefix,
  apiKeys,
  apps,
  newId,
  newPublicAppId,
  newSecretApiKey,
  sha256Hex,
  sponsorBalances,
  type ApiKeyRow,
  type Db,
} from '@pockey/db';
import { PaymentsError } from '@pockey/payments';
import {
  AdminAppConfigInput,
  AdminAppList,
  AdminEndUserList,
  AdminSession,
  ApiKeyId,
  ApiKeyList,
  ApiKeySummary,
  AppConfig,
  BillingPortalOutput,
  BillingSummary,
  CreateApiKeyInput,
  CreateApiKeyOutput,
  CreateAppInput,
  FREE_MONTHLY_ACTIVE_WALLETS,
  PRICE_CENTS_PER_ACTIVE_WALLET,
  SponsorBalance,
  TopUpCheckoutInput,
  TopUpCheckoutOutput,
  UpdateAppInput,
  UsageRange,
} from '@pockey/types';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { invalidateApp } from '../lib/apps.js';
import { getPayments } from '../lib/sponsor.js';
import { validate } from '../lib/validate.js';
import { loadOwnedApp, requireDeveloper } from '../middleware/developer.js';
import {
  assertSlugFree,
  slugify,
  toAdminApp,
  toAdminApps,
  uniqueSlug,
} from '../services/admin-apps.js';
import { adminUsage, currentMonthTotals } from '../services/admin-usage.js';
import { billingConfigured, ensureBilling } from '../services/billing.js';
import { toDeveloper } from '../services/developers.js';
import { countEndUsers, EndUserListQuery, listEndUsers } from '../services/end-users.js';
import { getBalance } from '../services/sponsoring.js';

/**
 * Dashboard API (spec sections 7.2 and 10, T5.1 and T5.3). Authenticated by the
 * developer session of `/admin/auth`, never by an app id or a secret key.
 * The contracts are `packages/types/src/admin.ts` and are final.
 */

const OkOutput = z.object({ ok: z.literal(true) });
const UsageQuery = z.object({ range: UsageRange.default('30d') });
const PortalQuery = z.object({ returnUrl: z.url().optional() });

function toApiKey(row: ApiKeyRow): ApiKeySummary {
  return ApiKeySummary.parse({
    id: row.id,
    appId: row.appId,
    prefix: row.prefix,
    name: row.name,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

async function developerApps(db: Db, developerId: string) {
  return db
    .select()
    .from(apps)
    .where(eq(apps.developerId, developerId))
    .orderBy(desc(apps.createdAt), desc(apps.id));
}

/** Provider failures never reach the dashboard as a stack trace, only as a code. */
function paymentsFailure(error: unknown, what: string): unknown {
  if (!(error instanceof PaymentsError)) return error;
  return new ApiError(
    error.code === 'invalid_payload' ? 'bad_request' : 'internal',
    `The payment provider could not ${what}`,
    { reason: error.code },
  );
}

export const adminRoutes = new Hono<AppEnv>()
  .use(requireDeveloper)

  /* Session */

  .get('/session', (c) => c.json(AdminSession.parse({ developer: toDeveloper(c.var.developer) })))

  /* Apps (T5.1) */

  .get('/apps', async (c) => {
    const rows = await developerApps(c.var.db, c.var.developer.id);
    return c.json(AdminAppList.parse({ apps: await toAdminApps(c.var.db, rows) }));
  })

  .post('/apps', validate('json', CreateAppInput), async (c) => {
    const input = c.req.valid('json');
    const developerId = c.var.developer.id;

    let slug: string;
    if (input.slug) {
      await assertSlugFree(c.var.db, developerId, input.slug);
      slug = input.slug;
    } else {
      slug = await uniqueSlug(c.var.db, developerId, slugify(input.name));
    }

    const id = newId('app');
    const publicId = newPublicAppId();
    const [row] = await c.var.db
      .insert(apps)
      .values({
        id,
        publicId,
        developerId,
        name: input.name,
        slug,
        allowedOrigins: input.allowedOrigins,
        config: AppConfig.parse(input.config ?? {}),
      })
      .returning();
    if (!row) throw new ApiError('internal', 'Could not create the app');

    await c.var.db
      .insert(sponsorBalances)
      .values({ appId: row.id, balanceCents: 0 })
      .onConflictDoNothing();
    await invalidateApp(row.publicId);
    return c.json(await toAdminApp(c.var.db, row), 201);
  })

  .get('/apps/:id', async (c) => c.json(await toAdminApp(c.var.db, await loadOwnedApp(c))))

  .patch('/apps/:id', validate('json', UpdateAppInput), async (c) => {
    const app = await loadOwnedApp(c);
    const input = c.req.valid('json');

    let slug = app.slug;
    if (input.slug && input.slug !== app.slug) {
      await assertSlugFree(c.var.db, app.developerId, input.slug, app.id);
      slug = input.slug;
    }
    // A partial config patches the stored one; a full replacement is PUT /config.
    const config = input.config
      ? AppConfig.parse({ ...AppConfig.parse(app.config), ...input.config })
      : AppConfig.parse(app.config);

    const [row] = await c.var.db
      .update(apps)
      .set({
        name: input.name ?? app.name,
        slug,
        allowedOrigins: input.allowedOrigins ?? app.allowedOrigins,
        config,
      })
      .where(eq(apps.id, app.id))
      .returning();
    if (!row) throw new ApiError('not_found', 'App not found');

    await invalidateApp(row.publicId);
    return c.json(await toAdminApp(c.var.db, row));
  })

  .put('/apps/:id/config', validate('json', AdminAppConfigInput), async (c) => {
    const app = await loadOwnedApp(c);
    const [row] = await c.var.db
      .update(apps)
      .set({ config: AppConfig.parse(c.req.valid('json').config) })
      .where(eq(apps.id, app.id))
      .returning();
    if (!row) throw new ApiError('not_found', 'App not found');

    // The edge cache holds the app row for 60 seconds, so the SDK would keep
    // serving the old config without this.
    await invalidateApp(row.publicId);
    return c.json(await toAdminApp(c.var.db, row));
  })

  .delete('/apps/:id', async (c) => {
    const app = await loadOwnedApp(c);
    await c.var.db.delete(apps).where(eq(apps.id, app.id));
    await invalidateApp(app.publicId);
    return c.json(OkOutput.parse({ ok: true }));
  })

  /* API keys (T5.1) */

  .get('/apps/:id/api-keys', async (c) => {
    const app = await loadOwnedApp(c);
    const rows = await c.var.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.appId, app.id))
      .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
    return c.json(ApiKeyList.parse({ keys: rows.map(toApiKey) }));
  })

  .post('/apps/:id/api-keys', validate('json', CreateApiKeyInput), async (c) => {
    const app = await loadOwnedApp(c);
    const secret = newSecretApiKey();
    const [row] = await c.var.db
      .insert(apiKeys)
      .values({
        id: newId('key'),
        appId: app.id,
        // Only the hash and the display prefix are stored, never the secret.
        hash: await sha256Hex(secret),
        prefix: apiKeyPrefix(secret),
        name: c.req.valid('json').name ?? null,
      })
      .returning();
    if (!row) throw new ApiError('internal', 'Could not create the API key');
    return c.json(CreateApiKeyOutput.parse({ key: toApiKey(row), secret }), 201);
  })

  .delete('/apps/:id/api-keys/:keyId', async (c) => {
    const app = await loadOwnedApp(c);
    const keyId = ApiKeyId.safeParse(c.req.param('keyId'));
    if (!keyId.success) throw new ApiError('not_found', 'API key not found');

    const key = await c.var.db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.id, keyId.data), eq(apiKeys.appId, app.id)),
    });
    if (!key) throw new ApiError('not_found', 'API key not found');

    // Idempotent: revoking twice is not an error, the first date is kept.
    if (!key.revokedAt) {
      await c.var.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, key.id), isNull(apiKeys.revokedAt)));
    }
    return c.json(OkOutput.parse({ ok: true }));
  })

  /* Usage, users and sponsoring (T5.3) */

  .get('/apps/:id/usage', validate('query', UsageQuery), async (c) => {
    const app = await loadOwnedApp(c);
    return c.json(await adminUsage(c.var.db, app.id, c.req.valid('query').range));
  })

  .get('/apps/:id/users', validate('query', EndUserListQuery), async (c) => {
    const app = await loadOwnedApp(c);
    const page = await listEndUsers(c.var.db, app, c.req.valid('query'));
    const total = await countEndUsers(c.var.db, app.id);
    return c.json(AdminEndUserList.parse({ ...page, total }));
  })

  .get('/apps/:id/sponsoring', async (c) => {
    const app = await loadOwnedApp(c);
    return c.json(SponsorBalance.parse(await getBalance(c.var.db, app)));
  })

  .post('/apps/:id/sponsoring/checkout', validate('json', TopUpCheckoutInput), async (c) => {
    const app = await loadOwnedApp(c);
    const { amountCents, successUrl, cancelUrl } = c.req.valid('json');
    try {
      const checkout = await getPayments(c.var.config).createTopUpCheckout({
        appId: app.id,
        amountCents,
        successUrl,
        cancelUrl,
        customerEmail: c.var.developer.email,
      });
      return c.json(TopUpCheckoutOutput.parse(checkout), 201);
    } catch (error) {
      // Provider text never contains the secret key, but keep only the code.
      throw paymentsFailure(error, 'create the checkout');
    }
  })

  /* Billing (section 11, T5.4 for the Stripe side) */

  .get('/billing', async (c) => {
    const developer = c.var.developer;
    const rows = await developerApps(c.var.db, developer.id);
    const ids = rows.map((row) => row.id);

    const usage = await currentMonthTotals(c.var.db, ids, new Date());
    let activeWallets = 0;
    for (const monthly of usage.values()) activeWallets += monthly.activeUsers;

    let sponsorBalanceCents = 0;
    if (ids.length > 0) {
      const balances = await c.var.db
        .select()
        .from(sponsorBalances)
        .where(inArray(sponsorBalances.appId, ids));
      for (const balance of balances) sponsorBalanceCents += balance.balanceCents;
    }

    const billable = Math.max(0, activeWallets - FREE_MONTHLY_ACTIVE_WALLETS);
    return c.json(
      BillingSummary.parse({
        plan: billable > 0 ? 'pay_as_you_go' : 'free',
        activeWallets,
        includedWallets: FREE_MONTHLY_ACTIVE_WALLETS,
        unitPriceCents: PRICE_CENTS_PER_ACTIVE_WALLET,
        estimatedCents: billable * PRICE_CENTS_PER_ACTIVE_WALLET,
        sponsorBalanceCents,
        // Same condition as the portal route: a customer already exists, or one
        // can be created because billing is configured on this server.
        portalAvailable: developer.stripeCustomerId !== null || billingConfigured(c.var.config),
      }),
    );
  })

  .get('/billing/portal', validate('query', PortalQuery), async (c) => {
    const payments = getPayments(c.var.config);
    const returnUrl = c.req.valid('query').returnUrl ?? `${c.var.config.DASHBOARD_ORIGIN}/billing`;
    try {
      // Creates the Stripe customer and the metered subscription on first use,
      // reuses them afterwards (T5.4).
      const customerId = await ensureBilling(c.var.db, payments, c.var.developer, c.var.config);
      if (customerId === null) {
        throw new ApiError(
          'bad_request',
          'Billing is not configured on this server, so the billing portal cannot open',
        );
      }
      const session = await payments.createBillingPortalSession({ customerId, returnUrl });
      return c.json(BillingPortalOutput.parse({ url: session.url }));
    } catch (error) {
      throw paymentsFailure(error, 'open the billing portal');
    }
  });
