import { signPersonalMessage, signTypedDataInput } from '@pockey/chains-evm';
import { signMessage as signSolanaMessage } from '@pockey/chains-solana';
import {
  buildCreateSigner,
  buildExportAccount,
  buildGrantRevoke,
  buildLogin,
  buildSessionPolicy,
  buildSignRaw,
  buildSignTransaction,
  evmWalletStamp,
  generateExportKey,
  generateSessionKey,
  loginSignature,
  sessionKeyParams,
  sessionStamper,
  signupSignature,
  solanaWalletStamp,
  stampRequest,
  type SessionKeyPair,
  type Stamper,
} from '@pockey/key-provider/client';
import { encryptOtpForTests } from '@pockey/key-provider/testing';
import {
  AuthResponse,
  EmailOtpStartOutput,
  EmailOtpVerifyOutput,
  PreparedOperation,
  PublicAppConfig,
  SessionSigner,
  SignerSetupOutput,
  durationToSeconds,
  type ChainFamily,
  type KeySession,
  type SendTransactionInput,
  type SignMessageInput,
  type SignTypedDataInput,
  type SigningPolicy,
  type StampedRequest,
  type Wallet,
} from '@pockey/types';
import { base64 } from '@scure/base';
import { hexToBytes, type Hex, type LocalAccount } from 'viem';
import { expect } from 'vitest';
import { bearer, otpFrom, postJson, request, SEED, withApp } from './helpers.js';

/**
 * What the embed iframe does, for API tests: holds a P-256 session key, encrypts
 * OTP codes for the key provider, and stamps every request touching the user's keys.
 * The API relays those requests to the Turnkey emulator (KEY_PROVIDER=mock), which
 * checks them like Turnkey does.
 */
export class Device {
  readonly stamper: Stamper;

  private constructor(
    readonly key: SessionKeyPair,
    public auth: AuthResponse,
    readonly publicId: string,
  ) {
    this.stamper = sessionStamper(key);
  }

  get keySession(): KeySession {
    return this.auth.keySession;
  }

  get accessToken(): string {
    return this.auth.accessToken;
  }

  headers(): Record<string, string> {
    return bearer(this.auth.accessToken, this.publicId);
  }

  wallet(family: ChainFamily): Wallet {
    const wallet = this.auth.user.wallets.find((item) => item.chainFamily === family);
    if (!wallet) throw new Error(`No ${family} wallet`);
    return wallet;
  }

  stamp(prepared: { path: string; body: string }): Promise<StampedRequest> {
    return stampRequest(prepared, this.stamper) as Promise<StampedRequest>;
  }

  /* Email OTP, the three steps of the iframe */

  static async emailStart(email: string, publicId: string = SEED.app.publicId, origin?: string) {
    const res = await postJson(
      '/v1/auth/email/start',
      { email },
      origin ? { Origin: origin } : {},
      publicId,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    return EmailOtpStartOutput.parse(await res.json());
  }

  static async loginWithEmail(
    email: string,
    options: { publicId?: string; origin?: string; code?: string } = {},
  ): Promise<Device> {
    const publicId = options.publicId ?? SEED.app.publicId;
    const extra = options.origin ? { Origin: options.origin } : {};
    const key = await generateSessionKey();
    const start = await Device.emailStart(email, publicId, options.origin);
    const encryptedOtpBundle = await encryptOtpForTests({
      code: options.code ?? otpFrom(email),
      targetBundle: start.targetBundle,
      publicKey: key.publicKey,
    });
    const verify = await postJson(
      '/v1/auth/email/verify',
      { otpId: start.otpId, encryptedOtpBundle },
      extra,
      publicId,
    );
    expect(verify.status, await verify.clone().text()).toBe(200);
    const { verificationToken, mode } = EmailOtpVerifyOutput.parse(await verify.json());

    let body: Record<string, unknown>;
    if (mode === 'signup') {
      const sessionKey = sessionKeyParams(key.publicKey);
      body = {
        mode,
        otpId: start.otpId,
        sessionKey,
        clientSignature: await signupSignature({ key, verificationToken, email, sessionKey }),
      };
    } else {
      body = {
        mode,
        otpId: start.otpId,
        publicKey: key.publicKey,
        clientSignature: await loginSignature({ key, verificationToken }),
      };
    }
    const login = await postJson('/v1/auth/email/login', body, extra, publicId);
    expect(login.status, await login.clone().text()).toBe(200);
    return new Device(key, AuthResponse.parse(await login.json()), publicId);
  }

  /* External wallets and passkeys */

  static async loginWithWallet(
    wallet:
      | { evm: LocalAccount }
      | { solana: { address: string; sign: (bytes: Uint8Array) => Promise<Uint8Array> } },
    publicId: string = SEED.app.publicId,
  ): Promise<{ device: Device; response: Response }> {
    const family: ChainFamily = 'evm' in wallet ? 'evm' : 'solana';
    const address = 'evm' in wallet ? wallet.evm.address : wallet.solana.address;
    const lookup = await postJson(
      '/v1/auth/wallet/lookup',
      { chainFamily: family, address },
      {},
      publicId,
    );
    expect(lookup.status, await lookup.clone().text()).toBe(200);
    const { organizationId } = await lookup.json<{ organizationId: string | null }>();
    const config = await appConfig(publicId);
    const key = await generateSessionKey();
    const prepared = buildLogin({
      parentOrganizationId: organizationId ?? config.keyProvider.organizationId,
      publicKey: key.publicKey,
    });
    const stamp =
      'evm' in wallet
        ? await evmWalletStamp(prepared.body, (message) => wallet.evm.signMessage({ message }))
        : await solanaWalletStamp(prepared.body, wallet.solana.address, wallet.solana.sign);
    const response = await postJson(
      '/v1/auth/wallet/login',
      { chainFamily: family, request: { ...prepared, stamp } },
      {},
      publicId,
    );
    const auth = response.ok ? AuthResponse.parse(await response.clone().json()) : null;
    return {
      device: auth ? new Device(key, auth, publicId) : (null as unknown as Device),
      response,
    };
  }

  static async loginWithPasskey(
    assert: (challenge: Uint8Array) => {
      credentialId: string;
      clientDataJson: string;
      authenticatorData: string;
      signature: string;
    },
    publicId: string = SEED.app.publicId,
  ): Promise<{ device: Device | null; response: Response }> {
    const { webauthnChallenge, webauthnStamp } = await import('@pockey/key-provider/client');
    const config = await appConfig(publicId);
    const key = await generateSessionKey();
    const prepared = buildLogin({
      parentOrganizationId: config.keyProvider.organizationId,
      publicKey: key.publicKey,
    });
    const request = { ...prepared, stamp: webauthnStamp(assert(webauthnChallenge(prepared.body))) };
    const response = await postJson('/v1/auth/passkey/login', { request }, {}, publicId);
    const auth = response.ok ? AuthResponse.parse(await response.clone().json()) : null;
    return { device: auth ? new Device(key, auth, publicId) : null, response };
  }

  /* Signing bodies */

  async signMessageBody(wallet: Wallet, input: SignMessageInput) {
    let payload: Uint8Array;
    if (input.chain === 'evm') {
      let digest: Hex = '0x';
      await signPersonalMessage(
        typeof input.message === 'string' ? input.message : { raw: input.message.raw as Hex },
        async (hash) => {
          digest = hash;
          return `0x${'00'.repeat(65)}`;
        },
      ).catch(() => undefined);
      payload = hexToBytes(digest);
    } else {
      payload = new Uint8Array(0);
      await signSolanaMessage(input.message, async (bytes) => {
        payload = bytes;
        return new Uint8Array(64);
      });
    }
    const request = await this.stamp(
      buildSignRaw({
        organizationId: this.keySession.organizationId,
        address: wallet.address,
        payload,
        encoding: input.chain === 'evm' ? 'hash' : 'raw',
      }),
    );
    return { input, request };
  }

  async signTypedDataBody(wallet: Wallet, input: SignTypedDataInput) {
    let digest: Hex = '0x';
    await signTypedDataInput(input, async (hash) => {
      digest = hash;
      return `0x${'00'.repeat(65)}`;
    }).catch(() => undefined);
    const request = await this.stamp(
      buildSignRaw({
        organizationId: this.keySession.organizationId,
        address: wallet.address,
        payload: hexToBytes(digest),
        encoding: 'hash',
      }),
    );
    return { input, request };
  }

  /** `POST /v1/wallets/:id/prepare`. */
  async prepare(wallet: Wallet, input: SendTransactionInput | Record<string, unknown>) {
    const res = await postJson(
      `/v1/wallets/${wallet.id}/prepare`,
      { input },
      this.headers(),
      this.publicId,
    );
    return { res, prepared: res.ok ? PreparedOperation.parse(await res.clone().json()) : null };
  }

  /** Body of sign-transaction or send-transaction, prepared first when EVM. */
  async transactionBody(wallet: Wallet, input: Record<string, unknown>) {
    const family = input.chain as ChainFamily;
    if (family === 'solana') {
      if (input.sponsored === true) {
        const request = await this.stamp(
          buildSignTransaction({
            organizationId: this.keySession.organizationId,
            address: wallet.address,
            chainFamily: 'solana',
            unsignedTransaction: String(input.transaction),
          }),
        );
        return { input, request };
      }
      const request = await this.stamp(
        buildSignTransaction({
          organizationId: this.keySession.organizationId,
          address: wallet.address,
          chainFamily: 'solana',
          unsignedTransaction: String(input.transaction),
        }),
      );
      return { input, request };
    }
    const { res, prepared } = await this.prepare(wallet, input);
    expect(res.status, await res.clone().text()).toBe(200);
    if (!prepared || prepared.kind === 'none') throw new Error('Nothing prepared');
    if (prepared.kind === 'transaction') {
      const request = await this.stamp(
        buildSignTransaction({
          organizationId: this.keySession.organizationId,
          address: wallet.address,
          chainFamily: 'evm',
          unsignedTransaction: prepared.unsignedTransaction,
        }),
      );
      return { input, request, ticket: prepared.ticket, prepared };
    }
    const request = await this.stamp(
      buildSignRaw({
        organizationId: this.keySession.organizationId,
        address: wallet.address,
        payload: hexToBytes(prepared.digest as Hex),
        encoding: 'hash',
      }),
    );
    return { input, request, ticket: prepared.ticket, prepared };
  }

  async exportBody(wallet: Wallet) {
    const exportKey = generateExportKey();
    const request = await this.stamp(
      buildExportAccount({
        organizationId: this.keySession.organizationId,
        address: wallet.address,
        targetPublicKey: exportKey.publicKey,
      }),
    );
    return { body: { request }, exportKey };
  }

  /* Session signers: set up the signer once, then one policy per session */

  async ensureSigner(): Promise<string> {
    if (this.keySession.signerUserId) return this.keySession.signerUserId;
    const config = await appConfig(this.publicId);
    const createSigner = await this.stamp(
      buildCreateSigner({
        organizationId: this.keySession.organizationId,
        signerPublicKey: config.keyProvider.signerPublicKey,
      }),
    );
    const res = await postJson(
      '/v1/sessions/signer',
      { createSigner },
      this.headers(),
      this.publicId,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const { signerUserId } = SignerSetupOutput.parse(await res.json());
    const grant = await this.stamp(
      buildGrantRevoke({ organizationId: this.keySession.organizationId, signerUserId }),
    );
    const permission = await postJson(
      '/v1/sessions/signer/permission',
      { request: grant },
      this.headers(),
      this.publicId,
    );
    expect(permission.status, await permission.clone().text()).toBe(200);
    this.auth = { ...this.auth, keySession: { ...this.keySession, signerUserId } };
    return signerUserId;
  }

  /** Body of `POST /v1/sessions`, stamped like the iframe after the consent screen. */
  async sessionBody(
    wallet: Wallet,
    policy: SigningPolicy | Record<string, unknown>,
    overrides: { expiresAt?: Date; stampPolicy?: SigningPolicy | Record<string, unknown> } = {},
  ) {
    const signerUserId = await this.ensureSigner();
    const account = this.keySession.accounts[wallet.chainFamily];
    const expiresIn = (policy as { expiresIn?: string }).expiresIn ?? '1h';
    const expiresAt = overrides.expiresAt ?? new Date(Date.now() + safeSeconds(expiresIn) * 1000);
    const policyName = `pockey:ses:${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const request = await this.stamp(
      buildSessionPolicy({
        organizationId: this.keySession.organizationId,
        policyName,
        policy: (overrides.stampPolicy ?? policy) as SigningPolicy,
        walletId: account.walletId,
        address: account.address,
        signerUserId,
        expiresAt,
      }),
    );
    return { walletId: wallet.id, policy, policyName, expiresAt: expiresAt.toISOString(), request };
  }

  async createSession(wallet: Wallet, policy: SigningPolicy | Record<string, unknown>) {
    const res = await postJson(
      '/v1/sessions',
      await this.sessionBody(wallet, policy),
      this.headers(),
      this.publicId,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    return SessionSigner.parse(await res.json());
  }
}

function safeSeconds(duration: string): number {
  try {
    return durationToSeconds(duration);
  } catch {
    return 3600;
  }
}

export async function appConfig(publicId: string = SEED.app.publicId): Promise<PublicAppConfig> {
  const res = await request(`/v1/apps/${publicId}/config`, { headers: withApp({}, publicId) });
  expect(res.status, await res.clone().text()).toBe(200);
  return PublicAppConfig.parse(await res.json());
}

/** Signature helpers for assertions. */
export const decodeBase64 = (value: string) => base64.decode(value);
