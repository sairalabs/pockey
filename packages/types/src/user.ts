import { z } from 'zod';
import { AppId, EndUserId, IdentityId } from './ids.js';
import { KeySession } from './keys.js';
import { Wallet } from './wallet.js';

export const IdentityType = z.enum(['email', 'google', 'apple', 'passkey', 'wallet']);
export type IdentityType = z.infer<typeof IdentityType>;

export const Identity = z.object({
  id: IdentityId,
  type: IdentityType,
  /** Email address, OAuth subject, passkey credential id or wallet address. */
  identifier: z.string().min(1).max(320),
  verifiedAt: z.iso.datetime().nullable(),
});
export type Identity = z.infer<typeof Identity>;

export const EndUser = z.object({
  id: EndUserId,
  appId: AppId,
  identities: z.array(Identity),
  wallets: z.array(Wallet),
  createdAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime().nullable(),
});
export type EndUser = z.infer<typeof EndUser>;

/** Response of `GET /v1/me`. */
export const MeResponse = z.object({
  user: EndUser,
  keySession: KeySession.nullable(),
});
export type MeResponse = z.infer<typeof MeResponse>;

/** `GET /v1/server/users` (secret API key). Cursor pagination, newest first. */
export const ServerUserList = z.object({
  users: z.array(EndUser),
  nextCursor: z.string().nullable(),
});
export type ServerUserList = z.infer<typeof ServerUserList>;
