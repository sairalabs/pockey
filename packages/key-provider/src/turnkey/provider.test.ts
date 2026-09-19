import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { SigningPolicy } from '@pocketkey/types';
import {
  hpkeDecrypt as turnkeyHpkeDecrypt,
  hpkeEncrypt as turnkeyHpkeEncrypt,
} from '@turnkey/crypto';
import { base58, base64, base64urlnopad } from '@scure/base';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  keccak256,
  parseTransaction,
  recoverAddress,
  recoverTransactionAddress,
  serializeTransaction,
  toHex,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { KeyProviderError, type StampedRequest } from '../index.js';
import {
  buildAddPasskey,
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
  oidcNonce,
  sessionKeyParams,
  sessionStamper,
  signupSignature,
  solanaWalletStamp,
  stampRequest,
  webauthnChallenge,
  webauthnStamp,
  type SessionKeyPair,
} from './client.js';
import { decryptExport, encryptOtp } from './client-crypto.js';
import { createTurnkeyEmulator, type TurnkeyEmulator } from './emulator/index.js';
import { hpkeDecrypt, hpkeEncrypt } from './hpke.js';
import { TurnkeyClient } from './http.js';
import { TurnkeyKeyProvider } from './provider.js';
import { createApiKeyStamper, generateApiKeyPair } from './stamp.js';
import { TestAuthenticator } from './test-authenticator.js';

let clock = Date.now();
const now = () => clock;
// Propagation retries wait on this clock, so a refusal settles instantly.
const advance = async (ms: number) => {
  clock += ms;
};
let emulator: TurnkeyEmulator;
let provider: TurnkeyKeyProvider;
const parentPair = generateApiKeyPair();
const signerPair = generateApiKeyPair();

beforeEach(() => {
  clock = Date.now();
  emulator = createTurnkeyEmulator({ parentPublicKey: parentPair.publicKey, now });
  provider = new TurnkeyKeyProvider({
    client: new TurnkeyClient({ transport: emulator, now, sleep: advance }),
    kind: 'emulator',
    parentOrgId: emulator.parentOrgId,
    parentStamper: createApiKeyStamper(parentPair),
    signerStamper: createApiKeyStamper(signerPair),
    enclaveSignerPublicKey: emulator.enclaveSignerPublicKey,
    now,
  });
});

async function verifiedToken(email: string, key: SessionKeyPair): Promise<string> {
  const { otpId, encryptionTargetBundle } = await provider.startEmailOtp({
    email,
    appName: 'Test',
  });
  const encryptedOtpBundle = await encryptOtp({
    code: emulator.lastOtp(email) ?? '',
    targetBundle: encryptionTargetBundle,
    publicKey: key.publicKey,
    enclaveSignerPublicKey: emulator.enclaveSignerPublicKey,
  });
  return (await provider.verifyEmailOtp({ otpId, encryptedOtpBundle })).verificationToken;
}

async function signUp(email = 'ada@example.com') {
  const key = await generateSessionKey();
  const verificationToken = await verifiedToken(email, key);
  const sessionKey = sessionKeyParams(key.publicKey, clock);
  const created = await provider.createSubOrganization({
    endUserId: 'usr_test',
    root: {
      kind: 'email',
      email,
      sessionKey,
      verificationToken,
      clientSignature: await signupSignature({ key, verificationToken, email, sessionKey }),
    },
  });
  return { key, stamper: sessionStamper(key), ...created };
}

const digest = hexToBytes(keccak256(toHex('pocketkey')).slice(2));

async function signRawAs(user: Awaited<ReturnType<typeof signUp>>, stamper = user.stamper) {
  const address = user.accounts.evm.address;
  const request = await stampRequest(
    buildSignRaw({ organizationId: user.subOrgId, address, payload: digest, encoding: 'hash' }),
    stamper,
  );
  return provider.relay(request, {
    kind: 'signRaw',
    subOrgId: user.subOrgId,
    address,
    encoding: 'hash',
    payload: digest,
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof KeyProviderError))
    throw new Error(`Expected a KeyProviderError, got ${String(error)}`);
  return error.code;
}

describe('HPKE port', () => {
  it('interoperates with @turnkey/crypto in both directions', async () => {
    const ours = generateExportKey();
    const theirs = generateExportKey();
    const plaintext = new TextEncoder().encode('secret material');

    const fromUs = await hpkeEncrypt(plaintext, hexToBytes(theirs.publicKey));
    expect(
      turnkeyHpkeDecrypt({
        ciphertextBuf: hexToBytes(fromUs.ciphertext),
        encappedKeyBuf: hexToBytes(fromUs.encappedPublic),
        receiverPriv: theirs.privateKey,
      }),
    ).toEqual(plaintext);

    const raw = turnkeyHpkeEncrypt({
      plainTextBuf: plaintext,
      targetKeyBuf: hexToBytes(ours.publicKey),
    });
    const { formatHpkeBuf } = await import('@turnkey/crypto');
    const formatted = JSON.parse(formatHpkeBuf(raw)) as {
      encappedPublic: string;
      ciphertext: string;
    };
    expect(await hpkeDecrypt(formatted, hexToBytes(ours.privateKey))).toEqual(plaintext);
  });
});

describe('email OTP', () => {
  it('signs up with the iframe key as the only credential, then signs', async () => {
    const user = await signUp();
    const facts = emulator.inspect(user.subOrgId);
    expect(facts.rootUser.email).toBe('ada@example.com');
    expect(facts.rootUser.apiKeys).toEqual([user.key.publicKey]);

    const { signature } = await signRawAs(user);
    const address = await recoverAddress({ hash: toHex(digest), signature: toHex(signature) });
    expect(address).toBe(user.accounts.evm.address);
  });

  it('refuses a sign-up whose credentials differ from what the iframe signed', async () => {
    const key = await generateSessionKey();
    const email = 'eve@example.com';
    const verificationToken = await verifiedToken(email, key);
    const signed = sessionKeyParams(key.publicKey, clock);
    const clientSignature = await signupSignature({
      key,
      verificationToken,
      email,
      sessionKey: signed,
    });
    const backendKey = generateApiKeyPair();
    const code = await codeOf(
      provider.createSubOrganization({
        endUserId: 'usr_x',
        root: {
          kind: 'email',
          email,
          sessionKey: { ...signed, publicKey: backendKey.publicKey },
          verificationToken,
          clientSignature,
        },
      }),
    );
    expect(code).toBe('unauthenticated');
  });

  it('logs in a second device with a fresh key, and refuses a wrong code', async () => {
    const user = await signUp();
    const second = await generateSessionKey();
    const verificationToken = await verifiedToken('ada@example.com', second);
    const session = await provider.otpLogin({
      subOrgId: user.subOrgId,
      verificationToken,
      publicKey: second.publicKey,
      clientSignature: await loginSignature({ key: second, verificationToken }),
      expirationSeconds: 3600,
    });
    expect(session.publicKey).toBe(second.publicKey);
    expect(session.subOrgId).toBe(user.subOrgId);
    await signRawAs(user, sessionStamper(second));

    const { otpId, encryptionTargetBundle } = await provider.startEmailOtp({
      email: 'ada@example.com',
      appName: 'Test',
    });
    const wrong = await encryptOtp({
      code: '000000' === emulator.lastOtp('ada@example.com') ? '111111' : '000000',
      targetBundle: encryptionTargetBundle,
      publicKey: second.publicKey,
      enclaveSignerPublicKey: emulator.enclaveSignerPublicKey,
    });
    expect(await codeOf(provider.verifyEmailOtp({ otpId, encryptedOtpBundle: wrong }))).toBe(
      'invalid_input',
    );
  });

  it('refuses a target bundle not signed by the pinned enclave key', async () => {
    const key = await generateSessionKey();
    const { encryptionTargetBundle } = await provider.startEmailOtp({
      email: 'ada@example.com',
      appName: 'Test',
    });
    // No override: the production Turnkey key is expected, the emulator key is refused.
    await expect(
      encryptOtp({
        code: '123456',
        targetBundle: encryptionTargetBundle,
        publicKey: key.publicKey,
      }),
    ).rejects.toThrow();
  });
});

describe('relay checks', () => {
  it('refuses a body that is not what the route expects', async () => {
    const user = await signUp();
    const address = user.accounts.evm.address;
    const request = await stampRequest(
      buildSignRaw({ organizationId: user.subOrgId, address, payload: digest, encoding: 'hash' }),
      user.stamper,
    );
    const expectation = {
      kind: 'signRaw' as const,
      subOrgId: user.subOrgId,
      address,
      encoding: 'hash' as const,
      payload: digest,
    };
    expect(
      await codeOf(provider.relay(request, { ...expectation, payload: new Uint8Array(32) })),
    ).toBe('unexpected_request');
    expect(
      await codeOf(
        provider.relay(request, { ...expectation, address: user.accounts.solana.address }),
      ),
    ).toBe('unexpected_request');
    expect(
      await codeOf(
        provider.relay(
          { ...request, path: '/public/v1/submit/export_wallet_account' },
          expectation,
        ),
      ),
    ).toBe('unexpected_request');
    const tampered: StampedRequest = {
      ...request,
      body: request.body.replace('HASH_FUNCTION_NO_OP', 'HASH_FUNCTION_NO_OP '),
    };
    expect(await codeOf(provider.relay(tampered, expectation))).toBe('unexpected_request');
  });

  it('never lets Pocketkey credentials act on user keys', async () => {
    const user = await signUp();
    const parentOnly = new TurnkeyKeyProvider({
      client: new TurnkeyClient({ transport: emulator, now, sleep: advance }),
      kind: 'emulator',
      parentOrgId: emulator.parentOrgId,
      parentStamper: createApiKeyStamper(parentPair),
      now,
    });
    const code = await codeOf(
      parentOnly.signRaw({
        subOrgId: user.subOrgId,
        address: user.accounts.evm.address,
        payload: digest,
        encoding: 'hash',
        scope: { kind: 'system' },
      }),
    );
    expect(['invalid_input', 'policy_denied', 'unauthenticated']).toContain(code);
    const signerCode = await codeOf(
      provider.signRaw({
        subOrgId: user.subOrgId,
        address: user.accounts.evm.address,
        payload: digest,
        encoding: 'hash',
        scope: { kind: 'system' },
      }),
    );
    expect(['policy_denied', 'unauthenticated', 'invalid_input']).toContain(signerCode);
  });
});

describe('session signers', () => {
  async function withSigner() {
    const user = await signUp();
    const { signerUserId } = await provider.relay(
      await stampRequest(
        buildCreateSigner({ organizationId: user.subOrgId, signerPublicKey: signerPair.publicKey }),
        user.stamper,
      ),
      { kind: 'createSigner', subOrgId: user.subOrgId },
    );
    await provider.relay(
      await stampRequest(
        buildGrantRevoke({ organizationId: user.subOrgId, signerUserId }),
        user.stamper,
      ),
      { kind: 'grantRevoke', subOrgId: user.subOrgId, signerUserId },
    );
    return { user, signerUserId };
  }

  async function createSession(
    user: Awaited<ReturnType<typeof signUp>>,
    signerUserId: string,
    policy: SigningPolicy,
    family: 'evm' | 'solana' = 'evm',
  ) {
    const account = user.accounts[family];
    const expiresAt = new Date(clock + 3600_000);
    const input = {
      organizationId: user.subOrgId,
      policyName: 'pocketkey:ses_test',
      policy,
      walletId: account.walletId,
      address: account.address,
      signerUserId,
      expiresAt,
    };
    const { policyId } = await provider.relay(
      await stampRequest(buildSessionPolicy(input), user.stamper),
      {
        kind: 'createSessionPolicy',
        subOrgId: user.subOrgId,
        policyName: input.policyName,
        policy,
        walletId: account.walletId,
        address: account.address,
        signerUserId,
        expiresAt,
      },
    );
    return {
      policyId,
      scope: { kind: 'session' as const, policyId, policyCreatedAt: new Date(clock) },
    };
  }

  const contract = '0x4200000000000000000000000000000000000006';
  const evmTx = (to: Hex, value: bigint) =>
    serializeTransaction({
      chainId: 84532,
      type: 'eip1559',
      to,
      value,
      nonce: 0,
      gas: 21000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1n,
    });

  it('signs exactly what the user allowed, and nothing after revocation or expiry', async () => {
    const { user, signerUserId } = await withSigner();
    const policy = {
      chain: 'evm',
      expiresIn: '1h',
      allowedChains: [84532],
      allowedContracts: [contract],
      maxValuePerTx: '1000',
    } as SigningPolicy;
    const session = await createSession(user, signerUserId, policy);
    const sign = (unsignedTransaction: string, family: 'evm' | 'solana' = 'evm') =>
      provider.signTransaction({
        subOrgId: user.subOrgId,
        address: user.accounts[family].address,
        chainFamily: family,
        unsignedTransaction,
        scope: session.scope,
      });

    const { signedTransaction } = await sign(evmTx(contract, 5n));
    expect(
      await recoverTransactionAddress({
        serializedTransaction: signedTransaction as `0x02${string}`,
      }),
    ).toBe(user.accounts.evm.address);
    expect(parseTransaction(signedTransaction as Hex).to?.toLowerCase()).toBe(contract);
    expect(await codeOf(sign(evmTx('0x1111111111111111111111111111111111111111', 5n)))).toBe(
      'policy_denied',
    );
    expect(await codeOf(sign(evmTx(contract, 5000n)))).toBe('policy_denied');
    expect(
      await codeOf(
        provider.signRaw({
          subOrgId: user.subOrgId,
          address: user.accounts.evm.address,
          payload: digest,
          encoding: 'hash',
          scope: session.scope,
        }),
      ),
    ).toBe('policy_denied');

    clock += 2 * 3600_000;
    expect(await codeOf(sign(evmTx(contract, 5n)))).toBe('policy_denied');
    clock -= 2 * 3600_000;

    await provider.deletePolicy({ subOrgId: user.subOrgId, policyId: session.policyId });
    expect(await codeOf(sign(evmTx(contract, 5n)))).toBe('policy_denied');
  });

  it('keeps an unrestricted Solana session away from the EVM account', async () => {
    const { user, signerUserId } = await withSigner();
    const session = await createSession(
      user,
      signerUserId,
      { chain: 'solana', expiresIn: '1h' },
      'solana',
    );
    const code = await codeOf(
      provider.signTransaction({
        subOrgId: user.subOrgId,
        address: user.accounts.evm.address,
        chainFamily: 'evm',
        unsignedTransaction: evmTx(contract, 1n),
        scope: session.scope,
      }),
    );
    expect(code).toBe('policy_denied');
  });

  it('refuses a policy wider than the one the API expects', async () => {
    const { user, signerUserId } = await withSigner();
    const account = user.accounts.evm;
    const expiresAt = new Date(clock + 3600_000);
    const narrow = { chain: 'evm', expiresIn: '1h', allowedContracts: [contract] } as SigningPolicy;
    const wide = { chain: 'evm', expiresIn: '1h' } as SigningPolicy;
    const request = await stampRequest(
      buildSessionPolicy({
        organizationId: user.subOrgId,
        policyName: 'pocketkey:ses_test',
        policy: wide,
        walletId: account.walletId,
        address: account.address,
        signerUserId,
        expiresAt,
      }),
      user.stamper,
    );
    const code = await codeOf(
      provider.relay(request, {
        kind: 'createSessionPolicy',
        subOrgId: user.subOrgId,
        policyName: 'pocketkey:ses_test',
        policy: narrow,
        walletId: account.walletId,
        address: account.address,
        signerUserId,
        expiresAt,
      }),
    );
    expect(code).toBe('unexpected_request');
  });

  it('refuses a signer user that holds another key', async () => {
    const user = await signUp();
    const request = await stampRequest(
      buildCreateSigner({
        organizationId: user.subOrgId,
        signerPublicKey: generateApiKeyPair().publicKey,
      }),
      user.stamper,
    );
    expect(
      await codeOf(provider.relay(request, { kind: 'createSigner', subOrgId: user.subOrgId })),
    ).toBe('unexpected_request');
  });
});

describe('transactions signed by the user', () => {
  it('signs an EVM transaction and a Solana message', async () => {
    const user = await signUp();
    const unsigned = serializeTransaction({
      chainId: 8453,
      type: 'eip1559',
      to: '0x000000000000000000000000000000000000dEaD',
      value: 1n,
      nonce: 1,
      gas: 21000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
    });
    const address = user.accounts.evm.address;
    const { signedTransaction } = await provider.relay(
      await stampRequest(
        buildSignTransaction({
          organizationId: user.subOrgId,
          address,
          chainFamily: 'evm',
          unsignedTransaction: unsigned,
        }),
        user.stamper,
      ),
      {
        kind: 'signTransaction',
        subOrgId: user.subOrgId,
        address,
        chainFamily: 'evm',
        unsignedTransaction: unsigned,
      },
    );
    expect(
      await recoverTransactionAddress({
        serializedTransaction: signedTransaction as `0x02${string}`,
      }),
    ).toBe(address);

    const solana = user.accounts.solana.address;
    const message = new TextEncoder().encode('hello');
    const { signature } = await provider.relay(
      await stampRequest(
        buildSignRaw({
          organizationId: user.subOrgId,
          address: solana,
          payload: message,
          encoding: 'raw',
        }),
        user.stamper,
      ),
      {
        kind: 'signRaw',
        subOrgId: user.subOrgId,
        address: solana,
        encoding: 'raw',
        payload: message,
      },
    );
    expect(ed25519.verify(signature, message, base58.decode(solana))).toBe(true);
  });
});

describe('export', () => {
  it('encrypts to the iframe key only, and the iframe decrypts it', async () => {
    const user = await signUp();
    for (const family of ['evm', 'solana'] as const) {
      const address = user.accounts[family].address;
      const key = generateExportKey();
      const { exportBundle } = await provider.relay(
        await stampRequest(
          buildExportAccount({
            organizationId: user.subOrgId,
            address,
            targetPublicKey: key.publicKey,
          }),
          user.stamper,
        ),
        { kind: 'exportAccount', subOrgId: user.subOrgId, address },
      );
      const secret = await decryptExport({
        exportBundle,
        key,
        organizationId: user.subOrgId,
        chainFamily: family,
        enclaveSignerPublicKey: emulator.enclaveSignerPublicKey,
      });
      if (family === 'evm') expect(privateKeyToAccount(secret as Hex).address).toBe(address);
      else expect(base58.encode(base58.decode(secret).slice(32))).toBe(address);
    }
  });
});

describe('wallet, passkey and OAuth logins', () => {
  it('signs up and logs in with an EVM wallet', async () => {
    const wallet = privateKeyToAccount(generatePrivateKey());
    const key = await generateSessionKey();
    const prepared = buildLogin({
      parentOrganizationId: emulator.parentOrgId,
      publicKey: key.publicKey,
    });
    const request: StampedRequest = {
      ...prepared,
      stamp: await evmWalletStamp(prepared.body, (message) => wallet.signMessage({ message })),
    };
    const identity = provider.inspectStamp(request);
    expect(identity?.scheme).toBe('secp256k1');
    expect(await codeOf(provider.relay(request, { kind: 'login' }))).toBe('unauthenticated');

    const created = await provider.createSubOrganization({
      endUserId: 'usr_w',
      root: {
        kind: 'wallet',
        chainFamily: 'evm',
        publicKey: identity?.scheme === 'secp256k1' ? identity.publicKey : '',
      },
    });
    const session = await provider.relay(request, { kind: 'login' });
    expect(session.subOrgId).toBe(created.subOrgId);
    expect(session.publicKey).toBe(key.publicKey);
  });

  it('logs in with a Solana wallet', async () => {
    const secret = ed25519.utils.randomSecretKey();
    const address = base58.encode(ed25519.getPublicKey(secret));
    const key = await generateSessionKey();
    const prepared = buildLogin({
      parentOrganizationId: emulator.parentOrgId,
      publicKey: key.publicKey,
    });
    const stamp = await solanaWalletStamp(prepared.body, address, async (bytes) =>
      ed25519.sign(bytes, secret),
    );
    const request: StampedRequest = { ...prepared, stamp };
    expect(provider.inspectStamp(request)).toEqual({
      scheme: 'ed25519',
      publicKey: bytesToHex(base58.decode(address)),
    });
    const created = await provider.createSubOrganization({
      endUserId: 'usr_s',
      root: {
        kind: 'wallet',
        chainFamily: 'solana',
        publicKey: bytesToHex(base58.decode(address)),
      },
    });
    expect((await provider.relay(request, { kind: 'login' })).subOrgId).toBe(created.subOrgId);
  });

  it('adds a passkey, then logs in with it without knowing the user', async () => {
    const user = await signUp();
    const authenticator = new TestAuthenticator();
    const registration = authenticator.register(crypto.getRandomValues(new Uint8Array(32)));
    const { credentialId } = await provider.relay(
      await stampRequest(
        buildAddPasskey({
          organizationId: user.subOrgId,
          userId: user.rootUserId,
          name: 'Laptop',
          ...registration,
        }),
        user.stamper,
      ),
      { kind: 'addPasskey', subOrgId: user.subOrgId, userId: user.rootUserId },
    );
    expect(credentialId).toBe(authenticator.credentialId);

    const key = await generateSessionKey();
    const prepared = buildLogin({
      parentOrganizationId: emulator.parentOrgId,
      publicKey: key.publicKey,
    });
    const request: StampedRequest = {
      ...prepared,
      stamp: webauthnStamp(authenticator.assert(webauthnChallenge(prepared.body))),
    };
    const session = await provider.relay(request, { kind: 'login' });
    expect(session.subOrgId).toBe(user.subOrgId);
    await signRawAs(user, sessionStamper(key));
  });

  it('accepts an OIDC token only when its nonce commits to the session key', async () => {
    const key = await generateSessionKey();
    const token = (nonce: string) =>
      [
        base64.encode(new TextEncoder().encode('{"alg":"none"}')),
        base64urlnopad.encode(
          new TextEncoder().encode(
            JSON.stringify({ iss: 'https://accounts.google.com', sub: '42', nonce }),
          ),
        ),
        'sig',
      ].join('.');
    const created = await provider.createSubOrganization({
      endUserId: 'usr_o',
      root: { kind: 'oidc', providerName: 'google', oidcToken: token(oidcNonce(key.publicKey)) },
    });
    const session = await provider.oauthLogin({
      subOrgId: created.subOrgId,
      oidcToken: token(oidcNonce(key.publicKey)),
      publicKey: key.publicKey,
      expirationSeconds: 3600,
    });
    expect(session.publicKey).toBe(key.publicKey);
    const other = await generateSessionKey();
    expect(
      await codeOf(
        provider.oauthLogin({
          subOrgId: created.subOrgId,
          oidcToken: token(oidcNonce(key.publicKey)),
          publicKey: other.publicKey,
          expirationSeconds: 3600,
        }),
      ),
    ).toBe('invalid_input');
  });
});

describe('system accounts', () => {
  it('belong to the signer only', async () => {
    const { subOrgId, account } = await provider.createSystemAccount({
      name: 'fee-payer',
      chainFamily: 'solana',
    });
    const message = new TextEncoder().encode('fee payer');
    const { signature } = await provider.signRaw({
      subOrgId,
      address: account.address,
      payload: message,
      encoding: 'raw',
      scope: { kind: 'system' },
    });
    expect(ed25519.verify(signature, message, base58.decode(account.address))).toBe(true);
  });
});
