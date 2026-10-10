/**
 * External wallet sign in through an injected wallet. The wallet signs the key
 * provider login request itself (it carries this iframe's session key), so the
 * provider, not Pockey, verifies the wallet. One prompt, sign-up included.
 * Loaded lazily with the rest of the wallet code.
 */
import type { AuthResponse } from '@pockey/types';
import { hex } from '@scure/base';
import { EmbedFailure } from './errors';
import { isHexString, isRecord } from './guards';
import type {
  Eip1193Provider,
  PhantomSolanaProvider,
  SignInContext,
  WalletAuthClient,
} from './wallets';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function invalid(message: string): EmbedFailure {
  return new EmbedFailure('unsupported', message);
}

export async function signInWithEvm(
  auth: WalletAuthClient,
  provider: Eip1193Provider,
  _context?: SignInContext,
): Promise<AuthResponse> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const address = Array.isArray(accounts) ? (accounts as unknown[])[0] : undefined;
  if (typeof address !== 'string' || !EVM_ADDRESS.test(address)) {
    throw invalid('The wallet did not return an account.');
  }
  return auth.loginWithWallet({
    chainFamily: 'evm',
    address,
    async personalSign(message) {
      const payload = `0x${hex.encode(new TextEncoder().encode(message))}`;
      const signature = await provider.request({
        method: 'personal_sign',
        params: [payload, address],
      });
      if (!isHexString(signature)) throw invalid('The wallet returned an invalid signature.');
      return signature;
    },
  });
}

function publicKeyOf(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const key = value.publicKey;
  let text: unknown = key;
  if (isRecord(key)) {
    // Solana PublicKey objects expose toBase58().
    const toBase58: unknown = key.toBase58;
    text = typeof toBase58 === 'function' ? Reflect.apply(toBase58, key, []) : null;
  }
  if (typeof text !== 'string') return null;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text) ? text : null;
}

export async function signInWithSolana(
  auth: WalletAuthClient,
  provider: PhantomSolanaProvider,
  _context?: SignInContext,
): Promise<AuthResponse> {
  const connected = await provider.connect();
  const address = publicKeyOf(connected) ?? publicKeyOf(provider);
  if (!address) throw invalid('The wallet did not return an account.');
  return auth.loginWithWallet({
    chainFamily: 'solana',
    address,
    async signMessage(message) {
      const signed = await provider.signMessage(message, 'utf8');
      const signature = isRecord(signed) ? signed.signature : undefined;
      if (!(signature instanceof Uint8Array)) {
        throw invalid('The wallet returned an invalid signature.');
      }
      return signature;
    },
  });
}
