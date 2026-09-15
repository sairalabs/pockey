import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema.js';

export type Db = DrizzleD1Database<typeof schema>;

/**
 * The only way to obtain a database handle. Callers receive the D1 binding
 * from the Worker env and never touch raw SQL outside this package.
 */
export function createDb(d1: D1Database): Db {
  return drizzle(d1, { schema, casing: 'snake_case' });
}

export { schema };
