import { apps, type AppRow, type Db } from '@pocketkey/db';
import { eq } from 'drizzle-orm';

/**
 * App lookup with an edge cache (T1.5). Every `/v1/*` request resolves its app,
 * so this is the hottest query in the API. The Workers Cache API keeps the row
 * for 60 seconds per colo; configuration changes from the dashboard call
 * `invalidateApp` and otherwise converge within a minute.
 */

export const APP_CACHE_TTL_SECONDS = 60;
const CACHE_ORIGIN = 'https://cache.pocketkey.internal';

const cacheKey = (publicId: string) => new Request(`${CACHE_ORIGIN}/apps/${publicId}`);

type CachedApp = Omit<AppRow, 'createdAt'> & { createdAt: string };

function getCache(): Cache | undefined {
  // `caches.default` exists on Workers and in Miniflare. Guard for other runtimes.
  // Cast: when DOM types are in scope (browser packages in tests), they hide `default`.
  return typeof caches === 'undefined'
    ? undefined
    : (caches as unknown as { default: Cache }).default;
}

export async function loadAppByPublicId(
  db: Db,
  publicId: string,
): Promise<{ app: AppRow | undefined; cache: 'HIT' | 'MISS' }> {
  const cache = getCache();
  if (cache) {
    const hit = await cache.match(cacheKey(publicId));
    if (hit) {
      const cached = await hit.json<CachedApp>();
      return { app: { ...cached, createdAt: new Date(cached.createdAt) }, cache: 'HIT' };
    }
  }

  const app = await db.query.apps.findFirst({ where: eq(apps.publicId, publicId) });
  if (app && cache) {
    const body: CachedApp = { ...app, createdAt: app.createdAt.toISOString() };
    await cache.put(
      cacheKey(publicId),
      new Response(JSON.stringify(body), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `max-age=${APP_CACHE_TTL_SECONDS}`,
        },
      }),
    );
  }
  // Unknown ids are never cached, so a freshly created app works immediately.
  return { app, cache: 'MISS' };
}

export async function invalidateApp(publicId: string): Promise<void> {
  await getCache()?.delete(cacheKey(publicId));
}
