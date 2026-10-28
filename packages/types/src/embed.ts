import { z } from 'zod';
import { Appearance, LoginMethod, PublicAppConfig } from './app.js';
import { ChainFamily } from './chains.js';
import {
  CreateSessionInput,
  SessionList,
  SessionSigner,
  SessionSignOutput,
  SessionSignRequest,
} from './session.js';
import { EndUser } from './user.js';
import {
  SendTransactionInput,
  SendTransactionOutput,
  SignMessageInput,
  SignMessageOutput,
  SignTransactionOutput,
  SignTypedDataInput,
  TransactionRequest,
  Wallet,
} from './wallet.js';

/**
 * postMessage protocol between the host page (`@pockey/react`) and the
 * iframe served from embed.pockey.xyz.
 *
 * - The host sends requests. Each carries a unique `requestId`.
 * - The embed answers every request with exactly one `response` carrying the
 *   same `requestId`, and may push events (`ready`, `visibility`, `authChanged`).
 * - Tokens never cross this boundary. The host only ever sees the user, wallets
 *   and signatures.
 * - The embed accepts messages only from `window.parent` and only when the
 *   sender origin is in the app allowlist. The host accepts messages only from
 *   the embed origin.
 */
export const EMBED_PROTOCOL_VERSION = 1 as const;

/** Every message on the wire is tagged, so unrelated postMessage traffic is ignored cheaply. */
export const EMBED_MESSAGE_TAG = 'pockey' as const;

const base = { source: z.literal(EMBED_MESSAGE_TAG), pk: z.literal(EMBED_PROTOCOL_VERSION) };
const request = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...base, requestId: z.string().min(1).max(64), ...shape });

/**
 * When false, the embed signs without showing a confirmation screen.
 * Defaults to true.
 */
const Confirm = z.boolean().optional();

/* Host -> embed requests */

export const HostRequest = z.discriminatedUnion('type', [
  request({
    type: z.literal('init'),
    /** Host-side overrides merged over the server appearance. */
    appearance: Appearance.partial().optional(),
    loginMethods: z.array(LoginMethod).min(1).optional(),
  }),
  request({
    type: z.literal('login'),
    /** Skip the method picker. */
    method: LoginMethod.optional(),
    /** Prefill (and for `email`, immediately send) the code to this address. */
    email: z.email().optional(),
  }),
  request({ type: z.literal('logout') }),
  request({ type: z.literal('getUser') }),
  request({ type: z.literal('createWallet'), chainFamily: ChainFamily }),
  request({
    type: z.literal('signMessage'),
    walletId: z.string(),
    input: SignMessageInput,
    confirm: Confirm,
  }),
  request({
    type: z.literal('signTypedData'),
    walletId: z.string(),
    input: SignTypedDataInput,
    confirm: Confirm,
  }),
  request({
    type: z.literal('signTransaction'),
    walletId: z.string(),
    input: TransactionRequest,
    confirm: Confirm,
  }),
  request({
    type: z.literal('sendTransaction'),
    walletId: z.string(),
    input: SendTransactionInput,
    confirm: Confirm,
  }),
  /** Opens the export screen. The key is revealed inside the iframe only. */
  request({ type: z.literal('exportWallet'), walletId: z.string() }),
  request({ type: z.literal('registerPasskey') }),
  /** Session signers. `createSession` shows a consent screen describing the policy. */
  request({ type: z.literal('createSession'), input: CreateSessionInput }),
  request({ type: z.literal('listSessions') }),
  request({ type: z.literal('revokeSession'), sessionId: z.string() }),
  /** Signs under an existing session without any UI. The policy is enforced server side. */
  request({
    type: z.literal('signWithSession'),
    sessionId: z.string(),
    request: SessionSignRequest,
  }),
  /** Closes any open screen, rejecting the pending interactive request with `user_rejected`. */
  request({ type: z.literal('close') }),
]);
export type HostRequest = z.infer<typeof HostRequest>;
export type HostRequestType = HostRequest['type'];

/** Result payload per request type, validated by the host before resolving. */
export const HostResponseData = {
  init: z.object({ user: EndUser.nullable(), config: PublicAppConfig }),
  login: z.object({ user: EndUser }),
  logout: z.object({ ok: z.literal(true) }),
  getUser: z.object({ user: EndUser.nullable() }),
  createWallet: Wallet,
  signMessage: SignMessageOutput,
  signTypedData: SignMessageOutput,
  signTransaction: SignTransactionOutput,
  sendTransaction: SendTransactionOutput,
  exportWallet: z.object({ ok: z.literal(true) }),
  registerPasskey: z.object({ user: EndUser }),
  createSession: SessionSigner,
  listSessions: SessionList,
  revokeSession: z.object({ ok: z.literal(true) }),
  signWithSession: SessionSignOutput,
  close: z.object({ ok: z.literal(true) }),
} satisfies Record<HostRequestType, z.ZodType>;

export type HostResponseDataMap = {
  [K in HostRequestType]: z.infer<(typeof HostResponseData)[K]>;
};

/* Embed -> host */

/**
 * Error codes an embed response can carry: every API error code plus the
 * protocol ones below. `user_rejected` maps to EIP-1193 error 4001.
 */
export const EMBED_ERROR_CODES = [
  'user_rejected',
  'not_authenticated',
  'not_ready',
  'unsupported',
  'wallet_not_found',
  'network_error',
  'invalid_message',
] as const;

export const EmbedError = z.object({
  code: z.string().min(1),
  message: z.string(),
  /** Machine reason, e.g. a POLICY_VIOLATIONS entry for session refusals. */
  reason: z.string().optional(),
});
export type EmbedError = z.infer<typeof EmbedError>;

export const EmbedMessage = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('ready') }),
  /** Ask the host to show or hide the iframe. The embed draws its own backdrop and dialog. */
  z.object({ ...base, type: z.literal('visibility'), visible: z.boolean() }),
  z.object({ ...base, type: z.literal('authChanged'), user: EndUser.nullable() }),
  z.object({
    ...base,
    type: z.literal('response'),
    requestId: z.string().min(1).max(64),
    ok: z.boolean(),
    data: z.unknown().optional(),
    error: EmbedError.optional(),
  }),
]);
export type EmbedMessage = z.infer<typeof EmbedMessage>;

/** Query parameter the host sets on the iframe URL. */
export const EMBED_APP_ID_PARAM = 'appId';
