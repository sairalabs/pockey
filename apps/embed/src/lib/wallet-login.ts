/**
 * SIWE and SIWS sign in through an injected wallet. Loaded lazily: it pulls the
 * message builders (viem's SIWE formatter and checksum) only when a wallet is used.
 */
import { buildSiweMessage } from '@pocketkey/chains-evm';
import { buildSiwsMessage } from '@pocketkey/chains-solana';
import type { AuthResponse } from '@pocketkey/types';
import { base64, hex } from '@scure/base';
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
  context: SignInContext,
): Promise<AuthResponse> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const address = Array.isArray(accounts) ? (accounts as unknown[])[0] : undefined;
  if (typeof address !== 'string' || !EVM_ADDRESS.test(address)) {
    throw invalid('The wallet did not return an account.');
  }
  const chainIdHex = await provider.request({ method: 'eth_chainId' });
  const chainId = typeof chainIdHex === 'string' ? Number.parseInt(chainIdHex, 16) : Number.NaN;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw invalid('The wallet did not return a chain.');
  }
  const { nonce } = await auth.getWalletNonce('evm');
  const message = buildSiweMessage({
    domain: context.domain,
    uri: context.uri,
    address: address as `0x${string}`,
    chainId,
    nonce,
    statement: context.statement,
  });
  const payload = `0x${hex.encode(new TextEncoder().encode(message))}`;
  const signature = await provider.request({ method: 'personal_sign', params: [payload, address] });
  if (!isHexString(signature)) throw invalid('The wallet returned an invalid signature.');
  return auth.loginWithSiwe({ message, signature });
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
  context: SignInContext,
): Promise<AuthResponse> {
  const connected = await provider.connect();
  const address = publicKeyOf(connected) ?? publicKeyOf(provider);
  if (!address) throw invalid('The wallet did not return an account.');
  const { nonce } = await auth.getWalletNonce('solana');
  const message = buildSiwsMessage({
    domain: context.domain,
    address,
    nonce,
    uri: context.uri,
    statement: context.statement.replace(/\s+/g, ' '),
  });
  const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
  const signature = isRecord(signed) ? signed.signature : undefined;
  if (!(signature instanceof Uint8Array))
    throw invalid('The wallet returned an invalid signature.');
  return auth.loginWithSiws({ message, signature: base64.encode(signature), publicKey: address });
}
