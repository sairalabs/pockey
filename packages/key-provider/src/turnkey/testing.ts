import { hexToBytes } from '@noble/hashes/utils.js';
import { hpkeEncrypt, type EnclaveBundle } from './hpke.js';

/**
 * Test helpers (`@pockey/key-provider/testing`), usable in the Workers pool.
 * They skip the enclave signature check the iframe performs: tests only.
 */

/** Same ciphertext as `encryptOtp`, for the emulator. */
export async function encryptOtpForTests(input: {
  code: string;
  targetBundle: string;
  publicKey: string;
}): Promise<string> {
  const bundle = JSON.parse(input.targetBundle) as EnclaveBundle;
  const data = JSON.parse(new TextDecoder().decode(hexToBytes(bundle.data))) as {
    targetPublic: string;
  };
  const encrypted = await hpkeEncrypt(
    new TextEncoder().encode(JSON.stringify({ otp_code: input.code, public_key: input.publicKey })),
    hexToBytes(data.targetPublic),
  );
  return JSON.stringify(encrypted);
}

export { TestAuthenticator } from './test-authenticator.js';
