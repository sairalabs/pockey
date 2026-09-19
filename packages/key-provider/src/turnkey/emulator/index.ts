import { ed25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { parseEvmTransaction } from '@pocketkey/chains-evm';
import {
  inspectTransaction,
  programIds,
  signTransaction as signSolanaTransaction,
  SYSTEM_PROGRAM_ID,
  type InspectedTransaction,
} from '@pocketkey/chains-solana';
import { base58, base64, base64urlnopad } from '@scure/base';
import { parseTransaction, serializeTransaction, type Hex } from 'viem';
import { TurnkeyRequestError, type TurnkeyTransport } from '../http.js';
import { hpkeDecrypt, hpkeEncrypt, signEnclaveBundle } from '../hpke.js';
import { sameJson, WALLET_SCHEME } from '../provider.js';
import { API_KEY_SCHEME, verifyApiKeyStamp, type Stamp } from '../stamp.js';
import { ACTIVITY, ACTIVITY_PATH, GRPC, QUERY_PATH, type ActivityType } from '../wire.js';
import { evaluate, parsePolicyExpression, type PolicyNode, type Value } from './policy-lang.js';
import { publicKeyFromAttestation, verifyWebAuthnStamp, type WebAuthnStamp } from './webauthn.js';

/**
 * In-memory Turnkey for tests and local development without Turnkey credentials.
 *
 * It speaks the real wire format behind `TurnkeyTransport`, so the provider, the
 * iframe and the API run exactly the code they run against Turnkey: stamps are
 * verified (P-256 API keys, EIP-191 and ed25519 wallets, WebAuthn), sub-organizations
 * are isolated from the parent, non-root users need a policy, policies are evaluated
 * (`policy-lang.ts`), OTP codes go through HPKE like the real enclaves.
 *
 * Keys are real and live in memory, which is acceptable only because the API refuses
 * `KEY_PROVIDER=mock` in production. State is lost when the process restarts: in
 * local development, use real Turnkey credentials to keep wallets across restarts.
 */

type Curve = 'secp256k1' | 'ed25519';
type CredentialCurve = 'p256' | 'secp256k1' | 'ed25519';

interface ApiKey {
  curve: CredentialCurve;
  expiresAt: number | null;
}

interface EmUser {
  id: string;
  name: string;
  root: boolean;
  email: string | null;
  apiKeys: Map<string, ApiKey>;
  /** credentialId -> uncompressed P-256 public key hex. */
  authenticators: Map<string, string>;
  oidc: { iss: string; sub: string }[];
}

interface EmAccount {
  address: string;
  curve: Curve;
  secret: Uint8Array;
}

interface EmPolicy {
  id: string;
  consensus: PolicyNode;
  condition: PolicyNode | null;
  time: PolicyNode | null;
}

interface EmOrg {
  id: string;
  isParent: boolean;
  users: Map<string, EmUser>;
  wallets: Map<string, EmAccount[]>;
  policies: Map<string, EmPolicy>;
}

interface PendingOtp {
  email: string;
  code: string;
  targetSecret: Uint8Array;
  expiresAt: number;
  attempts: number;
}

interface IssuedToken {
  id: string;
  email: string;
  publicKey: string;
  expiresAt: number;
  used: boolean;
}

export interface TurnkeyEmulatorOptions {
  parentOrgId?: string;
  /** Compressed P-256 public key of the parent API key (Pocketkey's credential). */
  parentPublicKey: string;
  /** Receives every OTP code, in place of Turnkey's email. */
  onOtp?: (email: string, code: string, appName: string) => void;
  now?: () => number;
}

export interface TurnkeyEmulator extends TurnkeyTransport {
  readonly parentOrgId: string;
  /** The key the fake enclave signs bundles with (uncompressed hex). */
  readonly enclaveSignerPublicKey: string;
  /** Test helper: last OTP code sent to an email. */
  lastOtp(email: string): string | undefined;
  /** Test helper: sub-organization facts. */
  inspect(subOrgId: string): {
    rootUser: { id: string; email: string | null; apiKeys: string[]; passkeys: string[] };
    users: number;
    policies: number;
  };
  /** Test helper: public key bytes of an account (EVM uncompressed, Solana raw). */
  publicKeyOf(address: string): Uint8Array;
  reset(): void;
}

class Failure extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

const denied = (message = "You don't have sufficient permissions to take this action.") =>
  new Failure(403, GRPC.permissionDenied, message);
const invalid = (message: string) => new Failure(400, GRPC.invalidArgument, message);
const notFound = (message: string) => new Failure(404, GRPC.notFound, message);
const unauthenticated = (message: string) => new Failure(401, GRPC.unauthenticated, message);

const uuid = () => crypto.randomUUID();
/** String field of a request body, or a fallback: bodies are untrusted JSON. */
const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const b64urlJson = (value: unknown) =>
  base64urlnopad.encode(new TextEncoder().encode(JSON.stringify(value)));
const decodeJwtPayload = (token: string): Record<string, unknown> => {
  const part = token.split('.')[1] ?? '';
  return JSON.parse(
    new TextDecoder().decode(base64urlnopad.decode(part.replace(/=+$/, ''))),
  ) as Record<string, unknown>;
};

function evmAddress(uncompressed: Uint8Array): string {
  const hash = keccak_256(uncompressed.slice(1));
  const lower = bytesToHex(hash.slice(-20));
  const checksum = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    const char = lower[i] ?? '';
    out += parseInt(checksum[i] ?? '0', 16) >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

function newAccount(curve: Curve): EmAccount {
  if (curve === 'secp256k1') {
    const secret = secp256k1.utils.randomSecretKey();
    return { curve, secret, address: evmAddress(secp256k1.getPublicKey(secret, false)) };
  }
  const secret = randomBytes(32);
  return { curve, secret, address: base58.encode(ed25519.getPublicKey(secret)) };
}

function personalHash(message: string): Uint8Array {
  const bytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
  const joined = new Uint8Array(prefix.length + bytes.length);
  joined.set(prefix);
  joined.set(bytes, prefix.length);
  return keccak_256(joined);
}

function solanaTransfers(tx: InspectedTransaction): Value[] {
  const out: Value[] = [];
  for (const instruction of tx.instructions) {
    const data = instruction.data;
    if (instruction.programId !== SYSTEM_PROGRAM_ID || data.length !== 12) continue;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(0, true) !== 2) continue;
    const from = tx.staticAccountKeys[instruction.accountIndexes[0] ?? -1];
    const to = tx.staticAccountKeys[instruction.accountIndexes[1] ?? -1];
    out.push({ from, to, amount: view.getBigUint64(4, true) });
  }
  return out;
}

export function createTurnkeyEmulator(options: TurnkeyEmulatorOptions): TurnkeyEmulator {
  const parentOrgId = options.parentOrgId ?? uuid();
  const now = options.now ?? Date.now;
  const enclaveSecret = p256.utils.randomSecretKey();
  const enclaveSignerPublicKey = bytesToHex(p256.getPublicKey(enclaveSecret, false));

  let orgs = new Map<string, EmOrg>();
  let otps = new Map<string, PendingOtp>();
  let tokens = new Map<string, IssuedToken>();
  let lastOtps = new Map<string, string>();
  let accountsByAddress = new Map<
    string,
    { orgId: string; walletId: string; account: EmAccount }
  >();

  function freshParent(): void {
    const parentUser: EmUser = {
      id: uuid(),
      name: 'Root user',
      root: true,
      email: null,
      apiKeys: new Map([
        [options.parentPublicKey.toLowerCase(), { curve: 'p256', expiresAt: null }],
      ]),
      authenticators: new Map(),
      oidc: [],
    };
    orgs.set(parentOrgId, {
      id: parentOrgId,
      isParent: true,
      users: new Map([[parentUser.id, parentUser]]),
      wallets: new Map(),
      policies: new Map(),
    });
  }
  freshParent();

  function org(id: string): EmOrg {
    const found = orgs.get(id);
    if (!found) throw notFound(`organization ${id} not found`);
    return found;
  }

  /* Authentication: which user of which organization stamped this body. */

  function findCredential(
    predicate: (user: EmUser) => boolean,
    preferredOrg: string,
  ): { org: EmOrg; user: EmUser } | null {
    const preferred = orgs.get(preferredOrg);
    if (preferred) {
      for (const user of preferred.users.values()) {
        if (predicate(user)) return { org: preferred, user };
      }
    }
    for (const candidate of orgs.values()) {
      for (const user of candidate.users.values()) {
        if (predicate(user)) return { org: candidate, user };
      }
    }
    return null;
  }

  function authenticate(
    body: string,
    stamp: Stamp,
    targetOrg: string,
  ): { org: EmOrg; user: EmUser } {
    if (stamp.header.toLowerCase() === 'x-stamp-webauthn') {
      const parsed = JSON.parse(stamp.value) as WebAuthnStamp;
      const found = findCredential(
        (user) => user.authenticators.has(parsed.credentialId),
        targetOrg,
      );
      if (!found) throw unauthenticated('could not find authenticator in organization');
      const publicKey = found.user.authenticators.get(parsed.credentialId) ?? '';
      if (!verifyWebAuthnStamp(body, parsed, publicKey))
        throw unauthenticated('invalid WebAuthn stamp');
      return found;
    }
    const json = JSON.parse(
      new TextDecoder().decode(base64urlnopad.decode(stamp.value.replace(/=+$/, ''))),
    ) as { publicKey: string; scheme: string; signature: string };
    const publicKey = json.publicKey.toLowerCase();
    let valid = false;
    if (json.scheme === API_KEY_SCHEME) valid = verifyApiKeyStamp(body, stamp) !== null;
    else if (json.scheme === WALLET_SCHEME.secp256k1) {
      valid = secp256k1.verify(
        hexToBytes(json.signature),
        personalHash(body),
        hexToBytes(publicKey),
        {
          prehash: false,
          format: 'der',
          lowS: false,
        },
      );
    } else if (json.scheme === WALLET_SCHEME.ed25519) {
      valid = ed25519.verify(
        hexToBytes(json.signature),
        new TextEncoder().encode(body),
        hexToBytes(publicKey),
      );
    }
    if (!valid) throw unauthenticated('invalid stamp');
    const found = findCredential((user) => {
      const key = user.apiKeys.get(publicKey);
      return key !== undefined && (key.expiresAt === null || key.expiresAt > now());
    }, targetOrg);
    if (!found) {
      throw unauthenticated(`could not find public key in organization publicKey=${publicKey}`);
    }
    return found;
  }

  /* Authorization */

  function authorize(
    target: EmOrg,
    actor: { org: EmOrg; user: EmUser },
    type: string,
    context: Record<string, Value>,
    parentMayAct = false,
  ): void {
    if (actor.org.id !== target.id) {
      if (parentMayAct && actor.org.isParent && !target.isParent) return;
      throw invalid(
        `organization mismatch: request is targeting organization (${target.id}), but voters are in organization (${actor.org.id})`,
      );
    }
    if (actor.user.root) return;
    const scope: Record<string, Value> = {
      ...context,
      activity: { type },
      time: { now: BigInt(now()) },
      approvers: [{ id: actor.user.id }],
    };
    for (const policy of target.policies.values()) {
      if (evaluate(policy.consensus, scope) !== true) continue;
      if (policy.condition && evaluate(policy.condition, scope) !== true) continue;
      if (policy.time && evaluate(policy.time, scope) !== true) continue;
      return;
    }
    throw denied();
  }

  /* Helpers */

  function account(orgId: string, address: string): { walletId: string; account: EmAccount } {
    const found = accountsByAddress.get(address);
    if (found?.orgId !== orgId) {
      throw notFound('Could not find any resource to sign with. Addresses are case sensitive.');
    }
    return found;
  }

  function addUser(target: EmOrg, input: Record<string, unknown>, root: boolean): EmUser {
    const user: EmUser = {
      id: uuid(),
      name: str(input.userName, 'user'),
      root,
      email: typeof input.userEmail === 'string' ? input.userEmail.toLowerCase() : null,
      apiKeys: new Map(),
      authenticators: new Map(),
      oidc: [],
    };
    for (const key of (input.apiKeys as Record<string, string>[] | undefined) ?? []) {
      const curve: CredentialCurve =
        key.curveType === 'API_KEY_CURVE_SECP256K1'
          ? 'secp256k1'
          : key.curveType === 'API_KEY_CURVE_ED25519'
            ? 'ed25519'
            : 'p256';
      const seconds = key.expirationSeconds ? Number(key.expirationSeconds) : null;
      user.apiKeys.set(String(key.publicKey).toLowerCase(), {
        curve,
        expiresAt: seconds === null ? null : now() + seconds * 1000,
      });
    }
    for (const authenticator of (input.authenticators as
      { attestation: { attestationObject: string } }[] | undefined) ?? []) {
      const { credentialId, publicKey } = publicKeyFromAttestation(
        authenticator.attestation.attestationObject,
      );
      user.authenticators.set(credentialId, publicKey);
    }
    for (const provider of (input.oauthProviders as { oidcToken: string }[] | undefined) ?? []) {
      const claims = decodeJwtPayload(provider.oidcToken);
      user.oidc.push({ iss: str(claims.iss, ''), sub: str(claims.sub, '') });
    }
    target.users.set(user.id, user);
    return user;
  }

  function createAccounts(
    orgId: string,
    walletParams: unknown,
  ): { walletId: string; addresses: string[] } | undefined {
    if (!walletParams || typeof walletParams !== 'object') return undefined;
    const walletId = uuid();
    const accounts = ((walletParams as { accounts?: { curve: string }[] }).accounts ?? []).map(
      (spec) => newAccount(spec.curve === 'CURVE_ED25519' ? 'ed25519' : 'secp256k1'),
    );
    org(orgId).wallets.set(walletId, accounts);
    for (const item of accounts)
      accountsByAddress.set(item.address, { orgId, walletId, account: item });
    return { walletId, addresses: accounts.map((item) => item.address) };
  }

  function session(target: EmOrg, user: EmUser, publicKey: string, seconds: number): string {
    const expiresAt = now() + seconds * 1000;
    user.apiKeys.set(publicKey.toLowerCase(), { curve: 'p256', expiresAt });
    return [
      b64urlJson({ alg: 'ES256', typ: 'JWT' }),
      b64urlJson({
        exp: Math.floor(expiresAt / 1000),
        public_key: publicKey.toLowerCase(),
        session_type: 'SESSION_TYPE_READ_WRITE',
        user_id: user.id,
        organization_id: target.id,
      }),
      'emulator',
    ].join('.');
  }

  function rootUser(target: EmOrg): EmUser {
    const found = [...target.users.values()].find((user) => user.root);
    if (!found) throw notFound('root user not found');
    return found;
  }

  function checkToken(token: string): IssuedToken {
    const claims = decodeJwtPayload(token);
    const issued = tokens.get(str(claims.id, ''));
    if (!issued || issued.used || issued.expiresAt <= now()) {
      throw unauthenticated('invalid or expired verification token');
    }
    return issued;
  }

  function checkClientSignature(signature: unknown, issued: IssuedToken, expected: unknown): void {
    const sig = signature as
      { publicKey?: string; message?: string; signature?: string; scheme?: string } | undefined;
    if (
      sig?.scheme !== 'CLIENT_SIGNATURE_SCHEME_API_P256' ||
      sig.publicKey?.toLowerCase() !== issued.publicKey
    ) {
      throw unauthenticated('client signature does not match the verification token');
    }
    const message = sig.message ?? '';
    if (!sameJson(JSON.parse(message), expected)) {
      throw unauthenticated('client signature message mismatch');
    }
    const ok = p256.verify(
      hexToBytes(sig.signature ?? ''),
      new TextEncoder().encode(message),
      hexToBytes(issued.publicKey),
      {
        prehash: true,
        format: 'compact',
        lowS: false,
      },
    );
    if (!ok) throw unauthenticated('invalid client signature');
  }

  function evmSign(secret: Uint8Array, digest: Uint8Array): { r: string; s: string; v: string } {
    const sig = secp256k1.sign(digest, secret, { prehash: false, format: 'recovered' });
    return {
      r: bytesToHex(sig.slice(1, 33)),
      s: bytesToHex(sig.slice(33, 65)),
      v: `0${sig[0] ?? 0}`,
    };
  }

  /* Activities */

  async function run(
    type: ActivityType,
    target: EmOrg,
    actor: { org: EmOrg; user: EmUser },
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    switch (type) {
      case ACTIVITY.createSubOrganization: {
        if (!target.isParent || actor.org.id !== target.id) throw denied();
        const sub: EmOrg = {
          id: uuid(),
          isParent: false,
          users: new Map(),
          wallets: new Map(),
          policies: new Map(),
        };
        const roots = (params.rootUsers as Record<string, unknown>[] | undefined) ?? [];
        if (params.verificationToken !== undefined) {
          const issued = checkToken(str(params.verificationToken, ''));
          const first = roots[0] ?? {};
          if (str(first.userEmail, '').toLowerCase() !== issued.email)
            throw unauthenticated('email does not match the verification token');
          const usage = {
            signupV2: {
              apiKeys: first.apiKeys,
              authenticators: first.authenticators,
              oauthProviders: first.oauthProviders,
              email: first.userEmail,
            },
            tokenId: issued.id,
            type: 'USAGE_TYPE_SIGNUP',
          };
          checkClientSignature(params.clientSignature, issued, usage);
          issued.used = true;
        }
        orgs.set(sub.id, sub);
        const rootIds = roots.map((root) => addUser(sub, root, true).id);
        const wallet = createAccounts(sub.id, params.wallet);
        return {
          createSubOrganizationResultV8: {
            subOrganizationId: sub.id,
            rootUserIds: rootIds,
            ...(wallet ? { wallet } : {}),
          },
        };
      }
      case ACTIVITY.createUsers: {
        authorize(target, actor, type, {});
        const users = (params.users as Record<string, unknown>[] | undefined) ?? [];
        return {
          createUsersResult: { userIds: users.map((user) => addUser(target, user, false).id) },
        };
      }
      case ACTIVITY.createPolicy: {
        authorize(target, actor, type, {});
        const id = uuid();
        target.policies.set(id, {
          id,
          consensus: parsePolicyExpression(str(params.consensus, 'true')),
          condition: params.condition ? parsePolicyExpression(str(params.condition, '')) : null,
          time: params.time ? parsePolicyExpression(str(params.time, '')) : null,
        });
        return { createPolicyResult: { policyId: id } };
      }
      case ACTIVITY.deletePolicy: {
        authorize(target, actor, type, {});
        if (!target.policies.delete(str(params.policyId, ''))) throw notFound('policy not found');
        return { deletePolicyResult: { policyId: params.policyId } };
      }
      case ACTIVITY.signRawPayload: {
        const { walletId, account: acc } = account(target.id, str(params.signWith, ''));
        authorize(target, actor, type, {
          wallet: { id: walletId },
          wallet_account: { address: acc.address },
        });
        const payload = hexToBytes(str(params.payload, '').replace(/^0x/, ''));
        if (acc.curve === 'secp256k1') {
          if (params.hashFunction !== 'HASH_FUNCTION_NO_OP' || payload.length !== 32)
            throw invalid('expected a 32-byte digest');
          return { signRawPayloadResult: evmSign(acc.secret, payload) };
        }
        if (params.hashFunction !== 'HASH_FUNCTION_NOT_APPLICABLE')
          throw invalid('ed25519 signs raw bytes');
        const signature = ed25519.sign(payload, acc.secret);
        return {
          signRawPayloadResult: {
            r: bytesToHex(signature.slice(0, 32)),
            s: bytesToHex(signature.slice(32)),
            v: '00',
          },
        };
      }
      case ACTIVITY.signTransaction: {
        const { walletId, account: acc } = account(target.id, str(params.signWith, ''));
        const unsigned = str(params.unsignedTransaction, '').replace(/^0x/, '');
        if (params.type === 'TRANSACTION_TYPE_ETHEREUM') {
          if (acc.curve !== 'secp256k1') throw invalid('not an Ethereum account');
          const hex: Hex = `0x${unsigned}`;
          const parsed = parseEvmTransaction(hex);
          authorize(target, actor, type, {
            wallet: { id: walletId },
            wallet_account: { address: acc.address },
            eth: {
              tx: {
                chain_id: BigInt(parsed.chainId),
                to: parsed.to ?? undefined,
                value: parsed.value,
                data: parsed.data,
              },
            },
          });
          const sig = evmSign(acc.secret, keccak_256(hexToBytes(unsigned)));
          const signed = serializeTransaction(parseTransaction(hex), {
            r: `0x${sig.r}`,
            s: `0x${sig.s}`,
            yParity: Number(sig.v),
          });
          return { signTransactionResult: { signedTransaction: signed.slice(2) } };
        }
        if (acc.curve !== 'ed25519') throw invalid('not a Solana account');
        const b64 = base64.encode(hexToBytes(unsigned));
        const inspected = inspectTransaction(b64);
        authorize(target, actor, type, {
          wallet: { id: walletId },
          wallet_account: { address: acc.address },
          solana: {
            tx: {
              program_keys: programIds(inspected),
              transfers: solanaTransfers(inspected),
              account_keys: inspected.staticAccountKeys,
            },
          },
        });
        const signed = await signSolanaTransaction(b64, {
          publicKey: acc.address,
          signBytes: async (bytes) => ed25519.sign(bytes, acc.secret),
        });
        return { signTransactionResult: { signedTransaction: bytesToHex(base64.decode(signed)) } };
      }
      case ACTIVITY.exportWalletAccount: {
        const { walletId, account: acc } = account(target.id, str(params.address, ''));
        authorize(target, actor, type, {
          wallet: { id: walletId },
          wallet_account: { address: acc.address },
        });
        const encrypted = await hpkeEncrypt(
          acc.secret,
          hexToBytes(str(params.targetPublicKey, '')),
        );
        return {
          exportWalletAccountResult: {
            address: acc.address,
            exportBundle: signEnclaveBundle(
              { organizationId: target.id, ...encrypted },
              enclaveSecret,
            ),
          },
        };
      }
      case ACTIVITY.initOtp: {
        if (!target.isParent || actor.org.id !== target.id) throw denied();
        const email = str(params.contact, '').toLowerCase();
        const code = String(parseInt(bytesToHex(randomBytes(4)), 16) % 1_000_000).padStart(6, '0');
        const targetSecret = p256.utils.randomSecretKey();
        const otpId = uuid();
        otps.set(otpId, {
          email,
          code,
          targetSecret,
          attempts: 0,
          expiresAt: now() + Number(params.expirationSeconds ?? 300) * 1000,
        });
        lastOtps.set(email, code);
        options.onOtp?.(email, code, str(params.appName, 'Pocketkey'));
        return {
          initOtpResultV2: {
            otpId,
            otpEncryptionTargetBundle: signEnclaveBundle(
              { targetPublic: bytesToHex(p256.getPublicKey(targetSecret, false)) },
              enclaveSecret,
            ),
          },
        };
      }
      case ACTIVITY.verifyOtp: {
        if (!target.isParent || actor.org.id !== target.id) throw denied();
        const pending = otps.get(str(params.otpId, ''));
        if (!pending || pending.expiresAt <= now()) throw invalid('OTP expired or unknown');
        pending.attempts += 1;
        if (pending.attempts > 5) {
          otps.delete(str(params.otpId, ''));
          throw invalid('Too many OTP attempts');
        }
        const bundle = JSON.parse(str(params.encryptedOtpBundle, '')) as {
          encappedPublic: string;
          ciphertext: string;
        };
        const plain = JSON.parse(
          new TextDecoder().decode(await hpkeDecrypt(bundle, pending.targetSecret)),
        ) as {
          otp_code: string;
          public_key: string;
        };
        if (plain.otp_code !== pending.code) throw invalid('Invalid OTP code');
        otps.delete(str(params.otpId, ''));
        const issued: IssuedToken = {
          id: uuid(),
          email: pending.email,
          publicKey: plain.public_key.toLowerCase(),
          expiresAt: now() + 600_000,
          used: false,
        };
        tokens.set(issued.id, issued);
        const token = [
          b64urlJson({ alg: 'ES256', typ: 'JWT' }),
          b64urlJson({
            id: issued.id,
            contact: issued.email,
            verification_type: 'OTP_TYPE_EMAIL',
            public_key: issued.publicKey,
            exp: Math.floor(issued.expiresAt / 1000),
          }),
          'emulator',
        ].join('.');
        return { verifyOtpResult: { verificationToken: token } };
      }
      case ACTIVITY.otpLogin: {
        authorize(target, actor, type, {}, true);
        const issued = checkToken(str(params.verificationToken, ''));
        const root = rootUser(target);
        if (root.email !== issued.email)
          throw unauthenticated('verification token is for another user');
        checkClientSignature(params.clientSignature, issued, {
          login: { publicKey: str(params.publicKey, '') },
          tokenId: issued.id,
          type: 'USAGE_TYPE_LOGIN',
        });
        issued.used = true;
        return {
          otpLoginResult: {
            session: session(
              target,
              root,
              str(params.publicKey, ''),
              Number(params.expirationSeconds ?? 900),
            ),
          },
        };
      }
      case ACTIVITY.oauthLogin: {
        authorize(target, actor, type, {}, true);
        const claims = decodeJwtPayload(str(params.oidcToken, ''));
        const nonce = bytesToHex(sha256(new TextEncoder().encode(str(params.publicKey, ''))));
        if (claims.nonce !== nonce) throw invalid('OIDC nonce does not commit to the session key');
        const root = rootUser(target);
        if (!root.oidc.some((entry) => entry.iss === claims.iss && entry.sub === claims.sub)) {
          throw unauthenticated('OIDC identity is not a credential of this organization');
        }
        return {
          oauthLoginResult: {
            session: session(
              target,
              root,
              str(params.publicKey, ''),
              Number(params.expirationSeconds ?? 900),
            ),
          },
        };
      }
      case ACTIVITY.stampLogin: {
        // Addressed to the parent, a login resolves to the organization of the credential.
        const home = actor.org;
        if (home.id !== target.id && !target.isParent) throw invalid('organization mismatch');
        return {
          stampLoginResult: {
            session: session(
              home,
              actor.user,
              str(params.publicKey, ''),
              Number(params.expirationSeconds ?? 900),
            ),
          },
        };
      }
      case ACTIVITY.createAuthenticators: {
        authorize(target, actor, type, {});
        const user = target.users.get(str(params.userId, ''));
        if (!user) throw notFound('user not found');
        const ids: string[] = [];
        const authenticators = Array.isArray(params.authenticators)
          ? (params.authenticators as { attestation: { attestationObject: string } }[])
          : [];
        for (const authenticator of authenticators) {
          const { credentialId, publicKey } = publicKeyFromAttestation(
            authenticator.attestation.attestationObject,
          );
          user.authenticators.set(credentialId, publicKey);
          ids.push(uuid());
        }
        return { createAuthenticatorsResult: { authenticatorIds: ids } };
      }
      case ACTIVITY.deleteSubOrganization: {
        authorize(target, actor, type, {});
        orgs.delete(target.id);
        return { deleteSubOrganizationResult: { subOrganizationUuid: target.id } };
      }
      default:
        throw invalid(`activity ${type} is not emulated`);
    }
  }

  const pathToType = new Map(
    Object.entries(ACTIVITY_PATH).map(([type, path]) => [path, type as ActivityType]),
  );

  async function handle(path: string, body: string, stamp: Stamp): Promise<unknown> {
    const json = JSON.parse(body) as {
      type?: string;
      organizationId?: string;
      parameters?: Record<string, unknown>;
      timestampMs?: string;
    };
    if (path === QUERY_PATH.whoami) {
      const actor = authenticate(body, stamp, String(json.organizationId));
      return {
        organizationId: actor.org.id,
        organizationName: actor.org.isParent ? 'Emulator' : `sub-${actor.org.id}`,
        userId: actor.user.id,
        username: actor.user.name,
      };
    }
    const type = pathToType.get(path);
    if (!type || json.type !== type) throw invalid(`unknown path ${path}`);
    const targetId = String(json.organizationId);
    const actor = authenticate(body, stamp, targetId);
    const target =
      type === ACTIVITY.stampLogin && targetId === parentOrgId ? org(parentOrgId) : org(targetId);
    const result = await run(type, target, actor, json.parameters ?? {});
    return {
      activity: {
        id: uuid(),
        organizationId: type === ACTIVITY.stampLogin ? actor.org.id : target.id,
        status: 'ACTIVITY_STATUS_COMPLETED',
        type,
        result,
      },
    };
  }

  return {
    parentOrgId,
    enclaveSignerPublicKey,
    async send(path, body, stamp) {
      try {
        return await handle(path, body, stamp);
      } catch (error) {
        if (error instanceof Failure) {
          throw new TurnkeyRequestError(error.status, {
            code: error.code,
            message: error.message,
            details: [],
          });
        }
        throw new TurnkeyRequestError(400, {
          code: GRPC.invalidArgument,
          message: error instanceof Error ? error.message : 'Invalid request',
          details: [],
        });
      }
    },
    lastOtp: (email) => lastOtps.get(email.toLowerCase()),
    inspect(subOrgId) {
      const target = org(subOrgId);
      const root = rootUser(target);
      return {
        rootUser: {
          id: root.id,
          email: root.email,
          apiKeys: [...root.apiKeys.keys()],
          passkeys: [...root.authenticators.keys()],
        },
        users: target.users.size,
        policies: target.policies.size,
      };
    },
    publicKeyOf(address) {
      const found = accountsByAddress.get(address);
      if (!found) throw new Error(`Unknown account ${address}`);
      return found.account.curve === 'secp256k1'
        ? secp256k1.getPublicKey(found.account.secret, false)
        : ed25519.getPublicKey(found.account.secret);
    },
    reset() {
      orgs = new Map();
      otps = new Map();
      tokens = new Map();
      lastOtps = new Map();
      accountsByAddress = new Map();
      freshParent();
    },
  };
}
