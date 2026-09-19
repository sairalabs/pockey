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

/**
 * The end user's key session, owned by the embed iframe (non-custodial since
 * 2026-09-19). The client never sees a key: it asks the `KeyClient` for requests
 * stamped by the session key and relays them to the API, which relays them to the
 * key provider. The embed implements this with Turnkey
 * (`@pocketkey/key-provider/client`), keys in IndexedDB.
 */

export type LoginCredential =
  | { kind: 'evm-wallet'; personalSign: (message: string) => Promise<`0x${string}`> }
  | {
      kind: 'solana-wallet';
      address: string;
      signMessage: (message: Uint8Array) => Promise<Uint8Array>;
    }
  | {
      kind: 'passkey';
      assert: (challenge: Uint8Array) => Promise<{
        credentialId: string;
        clientDataJson: string;
        authenticatorData: string;
        signature: string;
      }>;
    };

export interface PasskeyAttestation {
  credentialId: string;
  clientDataJson: string;
  attestationObject: string;
  transports: string[];
}

export interface KeyClient {
  /* Session key lifecycle */
  hasSession(): Promise<boolean>;
  /** Public key a login in progress registers. Created on first use. */
  pendingPublicKey(): Promise<string>;
  /** The login succeeded: the pending key becomes the session key. */
  activate(): Promise<void>;
  clear(): Promise<void>;

  /* Login proofs, bound to the pending key */
  encryptOtp(input: { code: string; targetBundle: string }): Promise<string>;
  signupProof(input: {
    verificationToken: string;
    email: string;
  }): Promise<{ sessionKey: SessionKeyParams; clientSignature: ClientSignature }>;
  loginProof(input: {
    verificationToken: string;
  }): Promise<{ publicKey: string; clientSignature: ClientSignature }>;
  loginRequest(input: {
    organizationId: string;
    credential: LoginCredential;
  }): Promise<StampedRequest>;

  /* Requests stamped with the session key */
  signMessage(input: {
    organizationId: string;
    address: string;
    message: SignMessageInput;
  }): Promise<StampedRequest>;
  signTypedData(input: {
    organizationId: string;
    address: string;
    typedData: SignTypedDataInput;
  }): Promise<StampedRequest>;
  /** Checks what the API prepared against the approved transaction, then stamps it. */
  signTransaction(input: {
    organizationId: string;
    address: string;
    transaction: TransactionRequest;
    prepared: PreparedOperation;
  }): Promise<StampedRequest>;
  exportAccount(input: {
    organizationId: string;
    address: string;
    chainFamily: ChainFamily;
  }): Promise<{ request: StampedRequest; reveal: (exportBundle: string) => Promise<string> }>;
  createSigner(input: { organizationId: string; signerPublicKey: string }): Promise<StampedRequest>;
  grantRevoke(input: { organizationId: string; signerUserId: string }): Promise<StampedRequest>;
  sessionPolicy(input: {
    organizationId: string;
    policyName: string;
    policy: SigningPolicy;
    walletId: string;
    address: string;
    signerUserId: string;
    expiresAt: Date;
  }): Promise<StampedRequest>;
  addPasskey(input: {
    organizationId: string;
    userId: string;
    name: string;
    challenge: string;
    attestation: PasskeyAttestation;
  }): Promise<StampedRequest>;
}
