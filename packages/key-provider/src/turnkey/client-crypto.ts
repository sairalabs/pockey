import { decryptExportBundle, encryptOtpCodeToBundle } from '@turnkey/crypto';
import type { ChainFamily } from '@pockey/types';
import type { ExportKey } from './client.js';

/**
 * Enclave crypto for the embed iframe (`@pockey/key-provider/client/crypto`),
 * delegated to Turnkey's own `@turnkey/crypto`: both functions verify that the
 * bundle is signed by Turnkey's production enclave key before using it.
 */

/**
 * Encrypts the code and the session public key to the enclave key of `targetBundle`,
 * after checking that bundle is signed by Turnkey. `enclaveSignerPublicKey` overrides
 * the pinned production key and must only ever be set by development builds.
 */
export async function encryptOtp(input: {
  code: string;
  targetBundle: string;
  publicKey: string;
  enclaveSignerPublicKey?: string;
}): Promise<string> {
  return encryptOtpCodeToBundle(
    input.code,
    input.targetBundle,
    input.publicKey,
    input.enclaveSignerPublicKey,
  );
}

/** EVM: 0x hex private key. Solana: base58 of the 64-byte secret key (Phantom format). */
export async function decryptExport(input: {
  exportBundle: string;
  key: ExportKey;
  organizationId: string;
  chainFamily: ChainFamily;
  enclaveSignerPublicKey?: string;
}): Promise<string> {
  const decrypted = await decryptExportBundle({
    exportBundle: input.exportBundle,
    embeddedKey: input.key.privateKey,
    organizationId: input.organizationId,
    returnMnemonic: false,
    ...(input.chainFamily === 'solana' ? { keyFormat: 'SOLANA' as const } : {}),
    ...(input.enclaveSignerPublicKey
      ? { dangerouslyOverrideSignerPublicKey: input.enclaveSignerPublicKey }
      : {}),
  });
  return input.chainFamily === 'evm' ? `0x${decrypted.replace(/^0x/, '')}` : decrypted;
}
