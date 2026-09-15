import { z } from 'zod';
import { Appearance, LoginMethod } from './app.js';
import { PublicAppId } from './ids.js';
import { EndUser } from './user.js';
import { SendTransactionInput, SignMessageInput, SignTypedDataInput } from './wallet.js';

/**
 * postMessage protocol between the host page (`@pocketkey/react`) and the
 * iframe served from embed.pocketkey.dev (section 4.1).
 *
 * Every message carries `pk: 1` (protocol version) and a `requestId` so the
 * host can correlate responses. Both sides verify `event.origin`.
 */
export const EMBED_PROTOCOL_VERSION = 1 as const;

const envelope = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ pk: z.literal(EMBED_PROTOCOL_VERSION), requestId: z.string().min(1), ...shape });

/* Host -> embed */

export const HostToEmbed = z.discriminatedUnion('type', [
  envelope({
    type: z.literal('init'),
    appId: PublicAppId,
    hostOrigin: z.url(),
    appearance: Appearance.partial().optional(),
  }),
  envelope({
    type: z.literal('login'),
    method: LoginMethod.optional(),
    email: z.email().optional(),
  }),
  envelope({ type: z.literal('logout') }),
  envelope({ type: z.literal('signMessage'), walletId: z.string(), input: SignMessageInput }),
  envelope({ type: z.literal('signTypedData'), walletId: z.string(), input: SignTypedDataInput }),
  envelope({
    type: z.literal('sendTransaction'),
    walletId: z.string(),
    input: SendTransactionInput,
  }),
  envelope({ type: z.literal('exportWallet'), walletId: z.string() }),
  envelope({ type: z.literal('close') }),
]);
export type HostToEmbed = z.infer<typeof HostToEmbed>;

/* Embed -> host */

export const EmbedToHost = z.discriminatedUnion('type', [
  envelope({ type: z.literal('ready') }),
  /** Ask the host to show or hide the modal (the embed never resizes itself). */
  envelope({ type: z.literal('visibility'), visible: z.boolean() }),
  envelope({ type: z.literal('authChanged'), user: EndUser.nullable() }),
  envelope({ type: z.literal('result'), ok: z.literal(true), data: z.unknown() }),
  envelope({
    type: z.literal('result'),
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);
export type EmbedToHost = z.infer<typeof EmbedToHost>;
