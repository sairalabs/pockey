import {
  decodeKernelExecute,
  deserializeUserOperation,
  parseEvmTransaction,
  userOperationDigest,
} from '@pocketkey/chains-evm';
import type {
  ChainFamily,
  ClientSignature,
  PreparedOperation,
  SessionKeyParams,
  SigningPolicy,
  SignMessageInput,
  SignTypedDataInput,
  StampedRequest,
  TransactionRequest,
} from '@pocketkey/types';
import { base64 } from '@scure/base';
import {
  hashMessage,
  hashTypedData,
  hexToBytes,
  type Address,
  type Hex,
  type TypedDataDefinition,
} from 'viem';
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
  sessionKeyParams,
  sessionStamper,
  signupSignature,
  solanaWalletStamp,
  stampRequest,
  webauthnChallenge,
  webauthnStamp,
  type ExportKey,
  type PasskeyAttestation,
  type SessionKeyPair,
} from './client.js';

/**
 * Turnkey implementation of the `KeyClient` the core SDK expects (structural: this
 * package does not depend on @pocketkey/core). It owns the iframe session key, turns
 * each operation into the exact provider request the API will compare, and checks
 * what the API prepared (EVM transactions, sponsored user operations) against what
 * the user approved before stamping it.
 */

export interface StoredKeys {
  active: SessionKeyPair | null;
  pending: SessionKeyPair | null;
}

/** Where the keys live. The iframe uses IndexedDB (non-extractable keys survive reloads). */
export interface KeyStore {
  load(): Promise<StoredKeys>;
  save(keys: StoredKeys): Promise<void>;
}

export function memoryKeyStore(): KeyStore {
  let keys: StoredKeys = { active: null, pending: null };
  return {
    load: async () => keys,
    save: async (next) => {
      keys = next;
    },
  };
}

/** Enclave crypto, injected so this module stays loadable where `@turnkey/crypto` is not. */
export interface EnclaveCrypto {
  encryptOtp: (input: {
    code: string;
    targetBundle: string;
    publicKey: string;
    enclaveSignerPublicKey?: string;
  }) => Promise<string>;
  decryptExport?: (input: {
    exportBundle: string;
    key: ExportKey;
    organizationId: string;
    chainFamily: ChainFamily;
    enclaveSignerPublicKey?: string;
  }) => Promise<string>;
}

export interface TurnkeyKeyClientOptions {
  store: KeyStore;
  enclave: EnclaveCrypto;
  /** Emulator enclave key (development builds only). */
  enclaveSignerPublicKey?: () => string | undefined;
}

export class KeyClientError extends Error {
  constructor(
    message: string,
    readonly reason: 'no_session' | 'prepared_mismatch' | 'unsupported' | 'invalid_input',
  ) {
    super(message);
    this.name = 'KeyClientError';
  }
}

const mismatch = (what: string): never => {
  throw new KeyClientError(
    `The prepared transaction does not match what you approved (${what})`,
    'prepared_mismatch',
  );
};

/** Digest of a message as the chain signs it: EIP-191 for EVM, raw bytes for Solana. */
export function messagePayload(input: SignMessageInput): Uint8Array {
  if (input.chain === 'evm') {
    const message =
      typeof input.message === 'string' ? input.message : { raw: input.message.raw as Hex };
    return hexToBytes(hashMessage(message));
  }
  return base64.decode(input.message);
}

export function typedDataPayload(input: SignTypedDataInput): Uint8Array {
  const { chain: _chain, ...definition } = input;
  return hexToBytes(
    hashTypedData(definition as unknown as TypedDataDefinition<Record<string, unknown>, string>),
  );
}

/** Checks the unsigned EVM transaction the API prepared against the approved request. */
export function checkPreparedTransaction(
  input: Extract<TransactionRequest, { chain: 'evm' }>,
  unsignedTransaction: string,
): void {
  const parsed = parseEvmTransaction(unsignedTransaction as Hex);
  if (parsed.signed) mismatch('already signed');
  if (parsed.chainId !== input.chainId) mismatch('chain');
  if ((parsed.to ?? '').toLowerCase() !== input.to.toLowerCase()) mismatch('recipient');
  if (parsed.value !== BigInt(input.value)) mismatch('value');
  if (parsed.data.toLowerCase() !== input.data.toLowerCase()) mismatch('data');
}

/** Checks a sponsored user operation: its digest, and the single call it executes. */
export function checkPreparedUserOperation(
  input: Extract<TransactionRequest, { chain: 'evm' }>,
  prepared: Extract<PreparedOperation, { kind: 'userOperation' }>,
): Hex {
  if (prepared.chainId !== input.chainId) mismatch('chain');
  const userOperation = deserializeUserOperation(prepared.userOperation);
  const { digest } = userOperationDigest({
    userOperation,
    chainId: prepared.chainId,
    entryPointAddress: prepared.entryPointAddress as Address,
  });
  if (digest.toLowerCase() !== prepared.digest.toLowerCase()) mismatch('digest');
  const call = decodeKernelExecute(userOperation.callData);
  if (call.to.toLowerCase() !== input.to.toLowerCase()) mismatch('recipient');
  if (call.value !== BigInt(input.value)) mismatch('value');
  if (call.data.toLowerCase() !== input.data.toLowerCase()) mismatch('data');
  return digest;
}

export type LoginCredential =
  | { kind: 'evm-wallet'; personalSign: (message: string) => Promise<Hex> }
  | {
      kind: 'solana-wallet';
      address: string;
      signMessage: (message: Uint8Array) => Promise<Uint8Array>;
    }
  | {
      kind: 'passkey';
      /** Runs `navigator.credentials.get` with this challenge, returns the assertion. */
      assert: (challenge: Uint8Array) => Promise<{
        credentialId: string;
        clientDataJson: string;
        authenticatorData: string;
        signature: string;
      }>;
    };

export function createTurnkeyKeyClient(options: TurnkeyKeyClientOptions) {
  const { store, enclave } = options;

  async function active(): Promise<SessionKeyPair> {
    const keys = await store.load();
    if (!keys.active) throw new KeyClientError('Sign in again to use your wallet', 'no_session');
    return keys.active;
  }

  async function pending(): Promise<SessionKeyPair> {
    const keys = await store.load();
    if (keys.pending) return keys.pending;
    const fresh = await generateSessionKey();
    await store.save({ ...keys, pending: fresh });
    return fresh;
  }

  const stamp = async (prepared: { path: string; body: string }) =>
    (await stampRequest(prepared, sessionStamper(await active()))) as StampedRequest;

  return {
    /* Session key lifecycle */

    async hasSession(): Promise<boolean> {
      return (await store.load()).active !== null;
    },
    /** Public key a login in progress will register. Created on first use. */
    async pendingPublicKey(): Promise<string> {
      return (await pending()).publicKey;
    },
    /** The login succeeded: the pending key becomes the session key. */
    async activate(): Promise<void> {
      const keys = await store.load();
      if (!keys.pending) throw new KeyClientError('No login in progress', 'invalid_input');
      await store.save({ active: keys.pending, pending: null });
    },
    async clear(): Promise<void> {
      await store.save({ active: null, pending: null });
    },

    /* Login proofs, bound to the pending key */

    async encryptOtp(input: { code: string; targetBundle: string }): Promise<string> {
      const key = await pending();
      const override = options.enclaveSignerPublicKey?.();
      return enclave.encryptOtp({
        code: input.code,
        targetBundle: input.targetBundle,
        publicKey: key.publicKey,
        ...(override ? { enclaveSignerPublicKey: override } : {}),
      });
    },
    async signupProof(input: {
      verificationToken: string;
      email: string;
    }): Promise<{ sessionKey: SessionKeyParams; clientSignature: ClientSignature }> {
      const key = await pending();
      const sessionKey = sessionKeyParams(key.publicKey);
      const clientSignature = await signupSignature({ key, ...input, sessionKey });
      return { sessionKey, clientSignature: clientSignature };
    },
    async loginProof(input: {
      verificationToken: string;
    }): Promise<{ publicKey: string; clientSignature: ClientSignature }> {
      const key = await pending();
      const clientSignature = await loginSignature({ key, ...input });
      return { publicKey: key.publicKey, clientSignature: clientSignature };
    },
    /** Login request carrying the pending key, stamped by a wallet or a passkey. */
    async loginRequest(input: {
      organizationId: string;
      credential: LoginCredential;
    }): Promise<StampedRequest> {
      const key = await pending();
      const prepared = buildLogin({
        parentOrganizationId: input.organizationId,
        publicKey: key.publicKey,
      });
      const credential = input.credential;
      const stampValue =
        credential.kind === 'evm-wallet'
          ? await evmWalletStamp(prepared.body, credential.personalSign)
          : credential.kind === 'solana-wallet'
            ? await solanaWalletStamp(prepared.body, credential.address, credential.signMessage)
            : webauthnStamp(await credential.assert(webauthnChallenge(prepared.body)));
      return { ...prepared, stamp: stampValue } as StampedRequest;
    },

    /* Requests stamped with the session key */

    signMessage(input: {
      organizationId: string;
      address: string;
      message: SignMessageInput;
    }): Promise<StampedRequest> {
      return stamp(
        buildSignRaw({
          organizationId: input.organizationId,
          address: input.address,
          payload: messagePayload(input.message),
          encoding: input.message.chain === 'evm' ? 'hash' : 'raw',
        }),
      );
    },
    signTypedData(input: {
      organizationId: string;
      address: string;
      typedData: SignTypedDataInput;
    }): Promise<StampedRequest> {
      return stamp(
        buildSignRaw({
          organizationId: input.organizationId,
          address: input.address,
          payload: typedDataPayload(input.typedData),
          encoding: 'hash',
        }),
      );
    },
    /** Checks what the API prepared, then stamps it. Solana needs no preparation. */
    signTransaction(input: {
      organizationId: string;
      address: string;
      transaction: TransactionRequest;
      prepared: PreparedOperation;
    }): Promise<StampedRequest> {
      const { transaction, prepared } = input;
      if (transaction.chain === 'solana') {
        return stamp(
          buildSignTransaction({
            organizationId: input.organizationId,
            address: input.address,
            chainFamily: 'solana',
            unsignedTransaction: transaction.transaction,
          }),
        );
      }
      if (prepared.kind === 'transaction') {
        checkPreparedTransaction(transaction, prepared.unsignedTransaction);
        return stamp(
          buildSignTransaction({
            organizationId: input.organizationId,
            address: input.address,
            chainFamily: 'evm',
            unsignedTransaction: prepared.unsignedTransaction,
          }),
        );
      }
      if (prepared.kind === 'userOperation') {
        const digest = checkPreparedUserOperation(transaction, prepared);
        return stamp(
          buildSignRaw({
            organizationId: input.organizationId,
            address: input.address,
            payload: hexToBytes(digest),
            encoding: 'hash',
          }),
        );
      }
      return Promise.reject(
        new KeyClientError('EVM transactions must be prepared', 'invalid_input'),
      );
    },
    /** Export request plus the function that decrypts the bundle, here, with a one-time key. */
    async exportAccount(input: {
      organizationId: string;
      address: string;
      chainFamily: ChainFamily;
    }): Promise<{ request: StampedRequest; reveal: (exportBundle: string) => Promise<string> }> {
      const decrypt = enclave.decryptExport;
      if (!decrypt) throw new KeyClientError('Export is not available here', 'unsupported');
      const key = generateExportKey();
      const request = await stamp(
        buildExportAccount({
          organizationId: input.organizationId,
          address: input.address,
          targetPublicKey: key.publicKey,
        }),
      );
      const override = options.enclaveSignerPublicKey?.();
      return {
        request,
        reveal: (exportBundle) =>
          decrypt({
            exportBundle,
            key,
            organizationId: input.organizationId,
            chainFamily: input.chainFamily,
            ...(override ? { enclaveSignerPublicKey: override } : {}),
          }),
      };
    },
    createSigner(input: {
      organizationId: string;
      signerPublicKey: string;
    }): Promise<StampedRequest> {
      return stamp(buildCreateSigner(input));
    },
    grantRevoke(input: { organizationId: string; signerUserId: string }): Promise<StampedRequest> {
      return stamp(buildGrantRevoke(input));
    },
    sessionPolicy(input: {
      organizationId: string;
      policyName: string;
      policy: SigningPolicy;
      walletId: string;
      address: string;
      signerUserId: string;
      expiresAt: Date;
    }): Promise<StampedRequest> {
      return stamp(buildSessionPolicy(input));
    },
    addPasskey(input: {
      organizationId: string;
      userId: string;
      name: string;
      challenge: string;
      attestation: PasskeyAttestation;
    }): Promise<StampedRequest> {
      return stamp(buildAddPasskey(input));
    },
  };
}

export type TurnkeyKeyClient = ReturnType<typeof createTurnkeyKeyClient>;
