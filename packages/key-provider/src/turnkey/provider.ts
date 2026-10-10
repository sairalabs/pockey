import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base64, base64urlnopad } from '@scure/base';
import { z } from 'zod';
import {
  KeyProviderError,
  type ClientSignature,
  type CreateSubOrganizationInput,
  type CreateSubOrganizationOutput,
  type KeyProvider,
  type KeyProviderInfo,
  type ProviderAccount,
  type ProviderSession,
  type RelayExpectation,
  type RelayResults,
  type SignerScope,
  type SignRawInput,
  type SignRawOutput,
  type SignTransactionInput,
  type SignTransactionOutput,
  type StampedRequest,
  type StampIdentity,
} from '../index.js';
import { PROPAGATION_WINDOW_MS, type SubmitOptions, type TurnkeyClient } from './http.js';
import { revokePermissionPolicy, toTurnkeyPolicy } from './policy.js';
import {
  API_KEY_SCHEME,
  STAMP_HEADER,
  verifyApiKeyStamp,
  WEBAUTHN_STAMP_HEADER,
  type Stamp,
  type Stamper,
} from './stamp.js';
import {
  ACTIVITY,
  ACTIVITY_PATH,
  activityResult,
  WALLET_ACCOUNT,
  type ActivityResponse,
  type ActivityType,
  type RootUserParams,
} from './wire.js';

/** Reads the login request a wallet signed: the session key it approves and its lifetime. */
export function readLoginRequest(request: StampedRequest): {
  organizationId: string;
  publicKey: string;
  expirationSeconds: number;
} | null {
  try {
    const body = JSON.parse(request.body) as {
      type?: string;
      organizationId?: string;
      parameters?: { publicKey?: string; expirationSeconds?: string };
    };
    const publicKey = body.parameters?.publicKey;
    const seconds = Number(body.parameters?.expirationSeconds);
    if (
      body.type !== ACTIVITY.stampLogin ||
      typeof body.organizationId !== 'string' ||
      typeof publicKey !== 'string' ||
      !/^0[23][0-9a-f]{64}$/.test(publicKey) ||
      !Number.isInteger(seconds) ||
      seconds <= 0 ||
      seconds > MAX_SESSION_SECONDS
    ) {
      return null;
    }
    return { organizationId: body.organizationId, publicKey, expirationSeconds: seconds };
  } catch {
    return null;
  }
}

/** Longest session key lifetime Pockey registers (matches the refresh token). */
export const MAX_SESSION_SECONDS = 30 * 24 * 3600;

export const WALLET_SCHEME = {
  secp256k1: 'SIGNATURE_SCHEME_TK_API_SECP256K1_EIP191',
  ed25519: 'SIGNATURE_SCHEME_TK_API_ED25519',
} as const;

const SubOrgResult = z.object({
  subOrganizationId: z.string().min(1),
  rootUserIds: z.array(z.string()).min(1),
  wallet: z.object({ walletId: z.string().min(1), addresses: z.array(z.string()).length(2) }),
});
const SystemSubOrgResult = z.object({
  subOrganizationId: z.string().min(1),
  wallet: z.object({ walletId: z.string().min(1), addresses: z.array(z.string()).length(1) }),
});
const SessionResult = z.object({ session: z.string().min(1) });
const SessionClaims = z.object({
  organization_id: z.string().min(1),
  user_id: z.string().min(1),
  public_key: z.string().min(1),
  exp: z.number(),
});
const RawSignatureResult = z.object({
  r: z.string().regex(/^[0-9a-fA-F]{64}$/),
  s: z.string().regex(/^[0-9a-fA-F]{64}$/),
  v: z.string().regex(/^[0-9a-fA-F]{2}$/),
});
const SignedTransactionResult = z.object({ signedTransaction: z.string().min(1) });
const PolicyResult = z.object({ policyId: z.string().min(1) });
const UsersResult = z.object({ userIds: z.array(z.string()).length(1) });
const ExportResult = z.object({ exportBundle: z.string().min(1) });
const OtpInitResult = z.object({
  otpId: z.string().min(1),
  otpEncryptionTargetBundle: z.string().min(1),
});
const OtpVerifyResult = z.object({ verificationToken: z.string().min(1) });

const ActivityBodySchema = z.object({
  type: z.string(),
  timestampMs: z.string().regex(/^\d{10,16}$/),
  organizationId: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
});
type ParsedBody = z.infer<typeof ActivityBodySchema>;

const unexpected = (reason: string): never => {
  throw new KeyProviderError(`Unexpected request: ${reason}`, 'unexpected_request');
};

function parseResult<T>(schema: z.ZodType<T>, response: ActivityResponse, prefix: string): T {
  const parsed = schema.safeParse(activityResult(response, prefix));
  if (!parsed.success) {
    throw new KeyProviderError(`Turnkey returned an unexpected ${prefix}`, 'unknown');
  }
  return parsed.data;
}

/** Order-insensitive deep equality of JSON values. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameJson(item, b[index]))
    );
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = Object.entries(a).filter(([, value]) => value !== undefined);
    const right = Object.entries(b).filter(([, value]) => value !== undefined);
    if (left.length !== right.length) return false;
    const rightMap = new Map(right);
    return left.every(([key, value]) => rightMap.has(key) && sameJson(value, rightMap.get(key)));
  }
  return false;
}

const stripHex = (value: string) => value.replace(/^0x/i, '').toLowerCase();

/** Decodes the payload of a Turnkey session JWT. Its signature is Turnkey's, and it
 * reached us straight from Turnkey over TLS, so the claims are trusted as is. */
export function decodeSession(jwt: string): ProviderSession {
  const payload = jwt.split('.')[1];
  if (!payload) throw new KeyProviderError('Malformed Turnkey session', 'unknown');
  const claims = SessionClaims.safeParse(
    JSON.parse(new TextDecoder().decode(base64urlnopad.decode(payload.replace(/=+$/, '')))),
  );
  if (!claims.success) throw new KeyProviderError('Malformed Turnkey session', 'unknown');
  return {
    subOrgId: claims.data.organization_id,
    userId: claims.data.user_id,
    publicKey: claims.data.public_key.toLowerCase(),
    expiresAt: new Date(claims.data.exp * 1000),
  };
}

/** EIP-191 `personal_sign` digest of a UTF-8 message. */
function personalMessageHash(message: string): Uint8Array {
  const bytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
  const joined = new Uint8Array(prefix.length + bytes.length);
  joined.set(prefix);
  joined.set(bytes, prefix.length);
  return keccak_256(joined);
}

const StampJson = z.object({
  publicKey: z.string().regex(/^[0-9a-fA-F]+$/),
  scheme: z.string(),
  signature: z.string().regex(/^[0-9a-fA-F]+$/),
});
const WebAuthnStampJson = z.object({ credentialId: z.string().min(1) });

/**
 * Verifies a stamp locally. Turnkey verifies it again; this only tells the API who
 * signed (wallet sign-up needs the public key before a sub-organization exists).
 * WebAuthn stamps are not verified here (no stored key): Turnkey is the verifier.
 */
export function inspectStamp(request: StampedRequest): StampIdentity | null {
  const stamp = request.stamp;
  if (stamp.header.toLowerCase() === WEBAUTHN_STAMP_HEADER.toLowerCase()) {
    try {
      const parsed = WebAuthnStampJson.safeParse(JSON.parse(stamp.value));
      return parsed.success ? { scheme: 'webauthn', credentialId: parsed.data.credentialId } : null;
    } catch {
      return null;
    }
  }
  if (stamp.header.toLowerCase() !== STAMP_HEADER.toLowerCase()) return null;
  let json: z.infer<typeof StampJson>;
  try {
    const parsed = StampJson.safeParse(
      JSON.parse(new TextDecoder().decode(base64urlnopad.decode(stamp.value.replace(/=+$/, '')))),
    );
    if (!parsed.success) return null;
    json = parsed.data;
  } catch {
    return null;
  }
  const publicKey = json.publicKey.toLowerCase();
  try {
    switch (json.scheme) {
      case API_KEY_SCHEME:
        return verifyApiKeyStamp(request.body, { header: STAMP_HEADER, value: stamp.value })
          ? { scheme: 'p256', publicKey }
          : null;
      case WALLET_SCHEME.secp256k1:
        return secp256k1.verify(
          hexToBytes(json.signature),
          personalMessageHash(request.body),
          hexToBytes(publicKey),
          { prehash: false, format: 'der', lowS: false },
        )
          ? { scheme: 'secp256k1', publicKey }
          : null;
      case WALLET_SCHEME.ed25519:
        return ed25519.verify(
          hexToBytes(json.signature),
          new TextEncoder().encode(request.body),
          hexToBytes(publicKey),
        )
          ? { scheme: 'ed25519', publicKey }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export interface TurnkeyKeyProviderOptions {
  client: TurnkeyClient;
  kind: KeyProviderInfo['kind'];
  parentOrgId: string;
  parentStamper: Stamper;
  /** Holds the delegated session key and owns system wallets. Defaults to the parent key. */
  signerStamper?: Stamper;
  enclaveSignerPublicKey?: string;
  now?: () => number;
}

export class TurnkeyKeyProvider implements KeyProvider {
  private readonly client: TurnkeyClient;
  private readonly parentOrgId: string;
  private readonly parent: Stamper;
  private readonly signer: Stamper;
  private readonly now: () => number;
  private readonly facts: KeyProviderInfo;

  constructor(options: TurnkeyKeyProviderOptions) {
    this.client = options.client;
    this.parentOrgId = options.parentOrgId;
    this.parent = options.parentStamper;
    this.signer = options.signerStamper ?? options.parentStamper;
    this.now = options.now ?? Date.now;
    this.facts = {
      kind: options.kind,
      organizationId: options.parentOrgId,
      signerPublicKey: this.signer.publicKey,
      ...(options.enclaveSignerPublicKey
        ? { enclaveSignerPublicKey: options.enclaveSignerPublicKey }
        : {}),
    };
  }

  info(): KeyProviderInfo {
    return this.facts;
  }

  /* Parent credential */

  async startEmailOtp(input: { email: string; appName: string; logoUrl?: string }) {
    const response = await this.client.activity(
      ACTIVITY.initOtp,
      this.parentOrgId,
      {
        otpType: 'OTP_TYPE_EMAIL',
        contact: input.email,
        appName: input.appName.slice(0, 64),
        otpLength: 6,
        alphanumeric: false,
        expirationSeconds: '600',
        ...(input.logoUrl ? { emailCustomization: { logoUrl: input.logoUrl } } : {}),
      },
      this.parent,
    );
    const result = parseResult(OtpInitResult, response, 'initOtpResult');
    return { otpId: result.otpId, encryptionTargetBundle: result.otpEncryptionTargetBundle };
  }

  async verifyEmailOtp(input: { otpId: string; encryptedOtpBundle: string }) {
    const response = await this.client.activity(
      ACTIVITY.verifyOtp,
      this.parentOrgId,
      {
        otpId: input.otpId,
        encryptedOtpBundle: input.encryptedOtpBundle,
        expirationSeconds: '600',
      },
      this.parent,
    );
    return parseResult(OtpVerifyResult, response, 'verifyOtpResult');
  }

  async createSubOrganization(
    input: CreateSubOrganizationInput,
  ): Promise<CreateSubOrganizationOutput> {
    const root: RootUserParams = {
      userName: 'end-user',
      apiKeys: [],
      authenticators: [],
      oauthProviders: [],
    };
    const extra: Record<string, unknown> = {};
    switch (input.root.kind) {
      case 'email':
        root.userEmail = input.root.email;
        root.apiKeys.push({
          apiKeyName: input.root.sessionKey.apiKeyName,
          publicKey: input.root.sessionKey.publicKey,
          curveType: 'API_KEY_CURVE_P256',
          expirationSeconds: input.root.sessionKey.expirationSeconds,
        });
        extra.verificationToken = input.root.verificationToken;
        extra.clientSignature = input.root.clientSignature;
        break;
      case 'oidc':
        root.oauthProviders.push({
          providerName: input.root.providerName,
          oidcToken: input.root.oidcToken,
        });
        break;
      case 'wallet':
        root.apiKeys.push({
          apiKeyName: `${input.root.chainFamily}-wallet`,
          publicKey: input.root.publicKey,
          curveType:
            input.root.chainFamily === 'evm' ? 'API_KEY_CURVE_SECP256K1' : 'API_KEY_CURVE_ED25519',
        });
        if (input.root.sessionKey) {
          root.apiKeys.push({
            apiKeyName: input.root.sessionKey.apiKeyName,
            publicKey: input.root.sessionKey.publicKey,
            curveType: 'API_KEY_CURVE_P256',
            expirationSeconds: input.root.sessionKey.expirationSeconds,
          });
        }
        break;
    }

    const response = await this.client.activity(
      ACTIVITY.createSubOrganization,
      this.parentOrgId,
      {
        subOrganizationName: `pockey-${input.endUserId}`,
        rootQuorumThreshold: 1,
        rootUsers: [root],
        wallet: { walletName: 'default', accounts: [WALLET_ACCOUNT.evm, WALLET_ACCOUNT.solana] },
        ...extra,
      },
      this.parent,
    );
    const result = parseResult(SubOrgResult, response, 'createSubOrganizationResult');
    const [evm, solana] = result.wallet.addresses as [string, string];
    return {
      subOrgId: result.subOrganizationId,
      rootUserId: result.rootUserIds[0] ?? '',
      accounts: {
        evm: { walletId: result.wallet.walletId, address: evm },
        solana: { walletId: result.wallet.walletId, address: solana },
      },
    };
  }

  async otpLogin(input: {
    subOrgId: string;
    verificationToken: string;
    publicKey: string;
    clientSignature: ClientSignature;
    expirationSeconds: number;
  }): Promise<ProviderSession> {
    const response = await this.client.activity(
      ACTIVITY.otpLogin,
      input.subOrgId,
      {
        verificationToken: input.verificationToken,
        publicKey: input.publicKey,
        clientSignature: input.clientSignature,
        expirationSeconds: String(Math.min(input.expirationSeconds, MAX_SESSION_SECONDS)),
      },
      this.parent,
      this.fresh(),
    );
    return decodeSession(parseResult(SessionResult, response, 'otpLoginResult').session);
  }

  async oauthLogin(input: {
    subOrgId: string;
    oidcToken: string;
    publicKey: string;
    expirationSeconds: number;
  }): Promise<ProviderSession> {
    const response = await this.client.activity(
      ACTIVITY.oauthLogin,
      input.subOrgId,
      {
        oidcToken: input.oidcToken,
        publicKey: input.publicKey,
        expirationSeconds: String(Math.min(input.expirationSeconds, MAX_SESSION_SECONDS)),
      },
      this.parent,
      this.fresh(),
    );
    return decodeSession(parseResult(SessionResult, response, 'oauthLoginResult').session);
  }

  /* End user credential */

  inspectStamp(request: StampedRequest): StampIdentity | null {
    return inspectStamp(request);
  }

  readLoginRequest(request: StampedRequest) {
    return readLoginRequest(request);
  }

  async relay<K extends RelayExpectation['kind']>(
    request: StampedRequest,
    expectation: Extract<RelayExpectation, { kind: K }>,
  ): Promise<RelayResults[K]> {
    const body = this.parseBody(request);
    const expected = expectation as RelayExpectation;
    const stamp: Stamp = {
      header:
        request.stamp.header.toLowerCase() === 'x-stamp' ? STAMP_HEADER : WEBAUTHN_STAMP_HEADER,
      value: request.stamp.value,
    };
    const send = (type: ActivityType, options: SubmitOptions = {}) => {
      if (request.path !== ACTIVITY_PATH[type]) unexpected('path does not match the activity');
      return this.client.submit(request.path, request.body, stamp, options);
    };

    let result: RelayResults[RelayExpectation['kind']];
    switch (expected.kind) {
      case 'signRaw': {
        this.expect(body, ACTIVITY.signRawPayload, expected.subOrgId);
        const params = body.parameters;
        if (params.signWith !== expected.address) unexpected('signWith');
        if (params.encoding !== 'PAYLOAD_ENCODING_HEXADECIMAL') unexpected('encoding');
        const hashFunction =
          expected.encoding === 'hash' ? 'HASH_FUNCTION_NO_OP' : 'HASH_FUNCTION_NOT_APPLICABLE';
        if (params.hashFunction !== hashFunction) unexpected('hashFunction');
        if (
          typeof params.payload !== 'string' ||
          stripHex(params.payload) !== bytesToHex(expected.payload)
        ) {
          unexpected('payload');
        }
        const response = await send(ACTIVITY.signRawPayload, this.fresh());
        result = {
          signature: rawSignature(
            parseResult(RawSignatureResult, response, 'signRawPayloadResult'),
            expected.address,
          ),
        };
        break;
      }
      case 'signTransaction': {
        this.expect(body, ACTIVITY.signTransaction, expected.subOrgId);
        const params = body.parameters;
        if (params.signWith !== expected.address) unexpected('signWith');
        const type =
          expected.chainFamily === 'evm' ? 'TRANSACTION_TYPE_ETHEREUM' : 'TRANSACTION_TYPE_SOLANA';
        if (params.type !== type) unexpected('transaction type');
        if (
          typeof params.unsignedTransaction !== 'string' ||
          stripHex(params.unsignedTransaction) !==
            unsignedHex(expected.chainFamily, expected.unsignedTransaction)
        ) {
          unexpected('unsignedTransaction');
        }
        const response = await send(ACTIVITY.signTransaction, this.fresh());
        const signed = parseResult(SignedTransactionResult, response, 'signTransactionResult');
        result = {
          signedTransaction: signedFromHex(expected.chainFamily, signed.signedTransaction),
        };
        break;
      }
      case 'exportAccount': {
        this.expect(body, ACTIVITY.exportWalletAccount, expected.subOrgId);
        if (body.parameters.address !== expected.address) unexpected('address');
        if (typeof body.parameters.targetPublicKey !== 'string') unexpected('targetPublicKey');
        const response = await send(ACTIVITY.exportWalletAccount);
        result = parseResult(ExportResult, response, 'exportWalletAccountResult');
        break;
      }
      case 'createSigner': {
        this.expect(body, ACTIVITY.createUsers, expected.subOrgId);
        const expectedUsers = [
          {
            userName: 'pockey-signer',
            apiKeys: [
              {
                apiKeyName: 'pockey',
                publicKey: this.signer.publicKey,
                curveType: 'API_KEY_CURVE_P256',
              },
            ],
            authenticators: [],
            oauthProviders: [],
            userTags: [],
          },
        ];
        if (!sameJson(body.parameters, { users: expectedUsers })) unexpected('signer user');
        const response = await send(ACTIVITY.createUsers);
        const [signerUserId] = parseResult(UsersResult, response, 'createUsersResult').userIds;
        result = { signerUserId: signerUserId ?? '' };
        break;
      }
      case 'grantRevoke': {
        this.expect(body, ACTIVITY.createPolicy, expected.subOrgId);
        if (!sameJson(body.parameters, revokePermissionPolicy(expected.signerUserId))) {
          unexpected('revoke permission policy');
        }
        const response = await send(ACTIVITY.createPolicy, this.fresh());
        result = parseResult(PolicyResult, response, 'createPolicyResult');
        break;
      }
      case 'createSessionPolicy': {
        this.expect(body, ACTIVITY.createPolicy, expected.subOrgId);
        const policy = toTurnkeyPolicy(expected.policy, {
          walletId: expected.walletId,
          address: expected.address,
          sessionUserId: expected.signerUserId,
          policyName: expected.policyName,
          expiresAt: expected.expiresAt,
        });
        if (!sameJson(body.parameters, policy)) unexpected('session policy');
        const response = await send(ACTIVITY.createPolicy, this.fresh());
        result = parseResult(PolicyResult, response, 'createPolicyResult');
        break;
      }
      case 'addPasskey': {
        this.expect(body, ACTIVITY.createAuthenticators, expected.subOrgId);
        const params = z
          .object({
            userId: z.literal(expected.userId),
            authenticators: z
              .array(
                z.object({
                  authenticatorName: z.string().min(1).max(64),
                  challenge: z.string().min(1),
                  attestation: z.object({ credentialId: z.string().min(1) }).loose(),
                }),
              )
              .length(1),
          })
          .safeParse(body.parameters);
        if (!params.success) unexpected('passkey');
        await send(ACTIVITY.createAuthenticators);
        result = {
          credentialId: params.data?.authenticators[0]?.attestation.credentialId ?? '',
        };
        break;
      }
      case 'login': {
        this.expect(body, ACTIVITY.stampLogin, expected.subOrgId ?? this.parentOrgId);
        const publicKey = body.parameters.publicKey;
        const seconds = Number(body.parameters.expirationSeconds);
        if (typeof publicKey !== 'string' || !/^0[23][0-9a-f]{64}$/i.test(publicKey)) {
          unexpected('session public key');
        }
        if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_SESSION_SECONDS) {
          unexpected('session lifetime');
        }
        const response = await send(ACTIVITY.stampLogin);
        const session = decodeSession(
          parseResult(SessionResult, response, 'stampLoginResult').session,
        );
        if (session.publicKey !== String(publicKey).toLowerCase()) {
          throw new KeyProviderError('Turnkey session is for another key', 'unknown');
        }
        if (expected.subOrgId !== undefined && session.subOrgId !== expected.subOrgId) {
          throw new KeyProviderError('Turnkey session is for another organization', 'unknown');
        }
        result = session;
        break;
      }
    }
    return result as RelayResults[K];
  }

  /* Pockey signer credential */

  async signRaw(input: SignRawInput): Promise<SignRawOutput> {
    const response = await this.client.activity(
      ACTIVITY.signRawPayload,
      input.subOrgId,
      {
        signWith: input.address,
        payload: bytesToHex(input.payload),
        encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
        hashFunction:
          input.encoding === 'hash' ? 'HASH_FUNCTION_NO_OP' : 'HASH_FUNCTION_NOT_APPLICABLE',
      },
      this.signer,
      this.scopeRetry(input.scope),
    );
    return {
      signature: rawSignature(
        parseResult(RawSignatureResult, response, 'signRawPayloadResult'),
        input.address,
      ),
    };
  }

  async signTransaction(input: SignTransactionInput): Promise<SignTransactionOutput> {
    const response = await this.client.activity(
      ACTIVITY.signTransaction,
      input.subOrgId,
      {
        signWith: input.address,
        unsignedTransaction: unsignedHex(input.chainFamily, input.unsignedTransaction),
        type: input.chainFamily === 'evm' ? 'TRANSACTION_TYPE_ETHEREUM' : 'TRANSACTION_TYPE_SOLANA',
      },
      this.signer,
      this.scopeRetry(input.scope),
    );
    const signed = parseResult(SignedTransactionResult, response, 'signTransactionResult');
    return { signedTransaction: signedFromHex(input.chainFamily, signed.signedTransaction) };
  }

  async deletePolicy(input: { subOrgId: string; policyId: string }): Promise<void> {
    await this.client.activity(
      ACTIVITY.deletePolicy,
      input.subOrgId,
      { policyId: input.policyId },
      this.signer,
    );
  }

  async createSystemAccount(input: {
    name: string;
    chainFamily: 'evm' | 'solana';
  }): Promise<{ subOrgId: string; account: ProviderAccount }> {
    const response = await this.client.activity(
      ACTIVITY.createSubOrganization,
      this.parentOrgId,
      {
        subOrganizationName: `pockey-system-${input.name}`,
        rootQuorumThreshold: 1,
        rootUsers: [
          {
            userName: 'pockey-system',
            apiKeys: [
              {
                apiKeyName: 'pockey',
                publicKey: this.signer.publicKey,
                curveType: 'API_KEY_CURVE_P256',
              },
            ],
            authenticators: [],
            oauthProviders: [],
          },
        ],
        wallet: { walletName: input.name, accounts: [WALLET_ACCOUNT[input.chainFamily]] },
      },
      this.parent,
    );
    const result = parseResult(SystemSubOrgResult, response, 'createSubOrganizationResult');
    return {
      subOrgId: result.subOrganizationId,
      account: { walletId: result.wallet.walletId, address: result.wallet.addresses[0] ?? '' },
    };
  }

  /* Helpers */

  private fresh(): SubmitOptions {
    // Login and signing right after a sub-organization, wallet or policy was created.
    return { retryUntil: this.now() + PROPAGATION_WINDOW_MS };
  }

  private scopeRetry(scope: SignerScope): SubmitOptions {
    if (scope.kind === 'system') return this.fresh();
    return { retryUntil: scope.policyCreatedAt.getTime() + PROPAGATION_WINDOW_MS };
  }

  private parseBody(request: StampedRequest): ParsedBody {
    if (request.body.length > 64_000) unexpected('body too large');
    let json: unknown;
    try {
      json = JSON.parse(request.body);
    } catch {
      return unexpected('body is not JSON');
    }
    const parsed = ActivityBodySchema.safeParse(json);
    if (!parsed.success) return unexpected('body is not an activity');
    const age = Math.abs(this.now() - Number(parsed.data.timestampMs));
    if (age > 10 * 60_000) unexpected('stale timestamp');
    return parsed.data;
  }

  private expect(body: ParsedBody, type: ActivityType, organizationId: string): void {
    if (body.type !== type) unexpected(`activity type ${body.type}`);
    if (body.organizationId !== organizationId) unexpected('organization');
  }
}

/** Turnkey returns r, s and a recovery id; EVM callers want r || s || (27 + v). */
function rawSignature(result: z.infer<typeof RawSignatureResult>, address: string): Uint8Array {
  const rs = hexToBytes(result.r + result.s);
  if (!address.startsWith('0x')) return rs;
  const out = new Uint8Array(65);
  out.set(rs);
  out[64] = 27 + (parseInt(result.v, 16) % 2);
  return out;
}

function unsignedHex(chainFamily: 'evm' | 'solana', unsigned: string): string {
  if (chainFamily === 'evm') return stripHex(unsigned);
  try {
    return bytesToHex(base64.decode(unsigned));
  } catch {
    throw new KeyProviderError('Solana transaction must be base64', 'invalid_input');
  }
}

function signedFromHex(chainFamily: 'evm' | 'solana', hex: string): string {
  return chainFamily === 'evm' ? `0x${stripHex(hex)}` : base64.encode(hexToBytes(stripHex(hex)));
}
