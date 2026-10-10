import type { KeyProvider } from '@pockey/key-provider';
import {
  createApiKeyStamper,
  createHttpTransport,
  createTurnkeyEmulator,
  generateApiKeyPair,
  TurnkeyClient,
  TurnkeyKeyProvider,
  type TurnkeyEmulator,
} from '@pockey/key-provider/turnkey';
import type { Mailer } from '@pockey/mailer';
import type { ParsedEnv } from '../env.js';

/**
 * One key provider per isolate.
 *
 * - `turnkey`: the real API with Pockey's parent credential, plus an optional
 *   separate signer key for session signers and system wallets.
 * - `mock`: the in-memory Turnkey emulator, same wire format. OTP codes go through
 *   the mailer (console in local development, memory in tests), where the Better
 *   Auth codes went before. Its state is lost on restart: use `turnkey` to keep
 *   wallets across `wrangler dev` restarts.
 */

interface Cached {
  provider: KeyProvider;
  emulator: TurnkeyEmulator | null;
}

let cached: Cached | undefined;

function build(config: ParsedEnv, mailer: Mailer): Cached {
  if (config.KEY_PROVIDER === 'turnkey') {
    const parent = createApiKeyStamper({
      publicKey: config.TURNKEY_API_PUBLIC_KEY ?? '',
      privateKey: config.TURNKEY_API_PRIVATE_KEY ?? '',
    });
    const signer =
      config.TURNKEY_SIGNER_PUBLIC_KEY && config.TURNKEY_SIGNER_PRIVATE_KEY
        ? createApiKeyStamper({
            publicKey: config.TURNKEY_SIGNER_PUBLIC_KEY,
            privateKey: config.TURNKEY_SIGNER_PRIVATE_KEY,
          })
        : parent;
    return {
      emulator: null,
      provider: new TurnkeyKeyProvider({
        client: new TurnkeyClient({
          transport: createHttpTransport({ baseUrl: config.TURNKEY_API_BASE_URL }),
        }),
        kind: 'turnkey',
        parentOrgId: config.TURNKEY_ORG_ID ?? '',
        parentStamper: parent,
        signerStamper: signer,
      }),
    };
  }

  const parentPair = generateApiKeyPair();
  const emulator = createTurnkeyEmulator({
    parentPublicKey: parentPair.publicKey,
    onOtp: (email, code, appName) => {
      // Same subject as the Better Auth mails before, so the e2e log reader still works.
      mailer
        .send({
          to: email,
          subject: `${code} is your ${appName} code`,
          text: `Your ${appName} code is ${code}. It expires in 10 minutes.`,
          tag: 'otp',
        })
        .catch((error: unknown) => {
          console.error('[key-provider] could not deliver the emulator OTP', error);
        });
    },
  });
  return {
    emulator,
    provider: new TurnkeyKeyProvider({
      client: new TurnkeyClient({ transport: emulator }),
      kind: 'emulator',
      parentOrgId: emulator.parentOrgId,
      parentStamper: createApiKeyStamper(parentPair),
      enclaveSignerPublicKey: emulator.enclaveSignerPublicKey,
    }),
  };
}

export function getKeyProvider(config: ParsedEnv, mailer: Mailer): KeyProvider {
  cached ??= build(config, mailer);
  return cached.provider;
}

/** Test helper: the emulator behind `KEY_PROVIDER=mock`. */
export function getEmulator(): TurnkeyEmulator {
  if (!cached?.emulator) throw new Error('The key provider emulator is not running');
  return cached.emulator;
}

/** Test helper. */
export function resetKeyProvider(): void {
  cached = undefined;
}
