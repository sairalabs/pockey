import { base58, base64, hex } from '@scure/base';
import { walletMark } from '../lib/wallet-marks';
import {
  durationToSeconds,
  EvmAddress,
  SigningPolicy,
  Wallet,
  type LoginMethod,
} from '@pockey/types';
import type { Screen, WalletOption } from '../lib/state';

/** Static mock data for the preview gallery. Nothing here touches the network. */

export const PREVIEW_ORIGIN = 'http://localhost:3810';

export const PREVIEW_METHODS: LoginMethod[] = ['email', 'google', 'apple', 'passkey', 'wallet'];

const evmWallet = Wallet.parse({
  id: 'wlt_a1b2c3d4e5f6g7h8i9j0k1l2',
  endUserId: 'usr_a1b2c3d4e5f6g7h8i9j0k1l2',
  chainFamily: 'evm',
  address: '0x4bF0c1A3e7D2b5F6a8C9d0E1f2A3b4C5d6E7F711',
  smartAccountAddress: null,
  createdAt: '2026-09-16T10:00:00.000Z',
});

const solanaKey = new Uint8Array(32).map((_, i) => (i * 37 + 11) % 256);
const recipientKey = new Uint8Array(32).map((_, i) => (i * 53 + 7) % 256);

const solanaWallet = Wallet.parse({
  id: 'wlt_b1b2c3d4e5f6g7h8i9j0k1l2',
  endUserId: 'usr_a1b2c3d4e5f6g7h8i9j0k1l2',
  chainFamily: 'solana',
  address: base58.encode(solanaKey),
  smartAccountAddress: null,
  createdAt: '2026-09-16T10:00:00.000Z',
});

/** A legacy, unsigned System Program transfer of `lamports` plus a memo-like extra instruction. */
function solanaTransfer(lamports: bigint): string {
  const bytes: number[] = [];
  bytes.push(1, ...new Uint8Array(64)); // one empty signature slot
  bytes.push(1, 0, 1); // header
  bytes.push(3, ...solanaKey, ...recipientKey, ...new Uint8Array(32)); // keys, system program last
  bytes.push(...new Uint8Array(32).fill(9)); // recent blockhash
  bytes.push(2); // two instructions
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  bytes.push(2, 2, 0, 1, data.length, ...data);
  bytes.push(2, 0, 0); // an empty instruction on the system program
  return base64.encode(new Uint8Array(bytes));
}

// The gallery shows the same brand marks a browser hands the modal at runtime.
const walletOptions: WalletOption[] = [
  { id: 'eip6963:rabby', name: 'Rabby', icon: walletMark('Rabby'), family: 'evm' },
  { id: 'injected', name: 'MetaMask', icon: walletMark('MetaMask'), family: 'evm' },
  { id: 'phantom:evm', name: 'Phantom', icon: walletMark('Phantom'), family: 'evm' },
  { id: 'phantom:solana', name: 'Phantom', icon: walletMark('Phantom'), family: 'solana' },
];

const SPENDER = EvmAddress.parse('0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD');

const GM = 'gm from the Pockey playground';

const evmSessionPolicy = SigningPolicy.parse({
  chain: 'evm',
  expiresIn: '7d',
  maxValuePerTx: '50000000000000000',
  maxValueTotal: '500000000000000000',
  allowedChains: [8453, 42161],
  allowedContracts: [
    SPENDER,
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    '0x4200000000000000000000000000000000000006',
    '0x2626664c2603336E57B271c5C0b26F421741e481',
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  ],
});

const solanaSessionPolicy = SigningPolicy.parse({
  chain: 'solana',
  expiresIn: '2h',
  maxValuePerTx: '100000000',
  allowedPrograms: [
    '11111111111111111111111111111111',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  ],
});

const unlimitedSessionPolicy = SigningPolicy.parse({ chain: 'evm', expiresIn: '15m' });

function sessionScreen(wallet: Wallet, policy: SigningPolicy, now: number): Screen {
  return {
    name: 'session',
    origin: PREVIEW_ORIGIN,
    wallet,
    policy,
    expiresAt: now + durationToSeconds(policy.expiresIn) * 1000,
    status: 'idle',
    error: null,
  };
}

export interface PreviewCard {
  id: string;
  label: string;
  screen: Screen;
}

export function previewCards(now: number): PreviewCard[] {
  return [
    { id: 'login', label: 'Login', screen: { name: 'login' } },
    {
      id: 'email-code',
      label: 'Email code',
      screen: {
        name: 'emailCode',
        email: 'ada@example.com',
        status: 'idle',
        error: null,
        resendAt: now + 30_000,
        resetKey: 0,
      },
    },
    {
      id: 'email-code-error',
      label: 'Email code, invalid',
      screen: {
        name: 'emailCode',
        email: 'ada@example.com',
        status: 'idle',
        error: 'That code is not valid. Try again.',
        resendAt: 0,
        resetKey: 0,
      },
    },
    {
      id: 'passkey',
      label: 'Passkey',
      screen: { name: 'passkey', mode: 'login', status: 'waiting', message: null },
    },
    {
      id: 'passkey-failed',
      label: 'Passkey, cancelled',
      screen: { name: 'passkey', mode: 'login', status: 'failed', message: null },
    },
    {
      id: 'wallets',
      label: 'Wallet list',
      screen: { name: 'wallets', status: 'ready', options: walletOptions },
    },
    {
      id: 'wallet-confirm',
      label: 'Wallet, confirm',
      screen: {
        name: 'walletConfirm',
        wallet: walletOptions[0] ?? { id: 'x', name: 'Wallet', icon: null, family: 'evm' },
        status: 'waiting',
        message: null,
      },
    },
    {
      id: 'wallets-empty',
      label: 'Wallet, none found',
      screen: { name: 'wallets', status: 'ready', options: [] },
    },
    {
      id: 'oauth',
      label: 'OAuth popup',
      screen: { name: 'oauth', provider: 'google', status: 'waiting', message: null },
    },
    {
      id: 'oauth-blocked',
      label: 'OAuth, popup blocked',
      screen: { name: 'oauth', provider: 'google', status: 'blocked', message: null },
    },
    { id: 'success', label: 'Success', screen: { name: 'success', title: 'You are in' } },
    {
      id: 'sign-message',
      label: 'Sign message',
      screen: {
        name: 'signMessage',
        origin: PREVIEW_ORIGIN,
        wallet: evmWallet,
        input: { chain: 'evm', message: GM },
        status: 'idle',
        error: null,
      },
    },
    {
      id: 'sign-message-hex',
      label: 'Sign message, hex payload',
      screen: {
        name: 'signMessage',
        origin: PREVIEW_ORIGIN,
        wallet: evmWallet,
        input: {
          chain: 'evm',
          message: {
            raw: `0x${hex.encode(
              new TextEncoder().encode(
                'Welcome to Playground.\n\nSign to accept the terms.\n\nNonce: 8f3a2c91',
              ),
            )}`,
          },
        },
        status: 'idle',
        error: null,
      },
    },
    {
      id: 'sign-typed-data',
      label: 'Sign data',
      screen: {
        name: 'signTypedData',
        origin: PREVIEW_ORIGIN,
        wallet: evmWallet,
        input: {
          chain: 'evm',
          domain: { name: 'USD Coin', version: '2', chainId: 8453 },
          primaryType: 'Permit',
          types: {
            Permit: [
              { name: 'owner', type: 'address' },
              { name: 'spender', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
            ],
          },
          message: {
            owner: evmWallet.address,
            spender: SPENDER,
            value: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
            nonce: '0',
            deadline: '1789500000',
            details: { route: 'swap', slippageBps: 50 },
          },
        },
        status: 'idle',
        error: null,
      },
    },
    {
      id: 'send-transaction',
      label: 'Confirm transaction',
      screen: {
        name: 'transaction',
        kind: 'send',
        origin: PREVIEW_ORIGIN,
        wallet: evmWallet,
        input: {
          chain: 'evm',
          chainId: 8453,
          to: SPENDER,
          value: '12500000000000000',
          data: '0xa9059cbb0000000000000000000000003fc91a3afd70395cd496c647d5a6cc9d4b2b7fad00000000000000000000000000000000000000000000000000000000000f4240',
          sponsored: true,
        },
        status: 'idle',
        error: null,
      },
    },
    {
      id: 'send-transaction-pending',
      label: 'Confirm transaction, pending',
      screen: {
        name: 'transaction',
        kind: 'send',
        origin: PREVIEW_ORIGIN,
        wallet: evmWallet,
        input: {
          chain: 'evm',
          chainId: 1,
          to: SPENDER,
          value: '1234567891234567891',
          data: '0x',
          sponsored: false,
        },
        status: 'pending',
        error: null,
      },
    },
    {
      id: 'sign-transaction-solana',
      label: 'Confirm transaction, Solana',
      screen: {
        name: 'transaction',
        kind: 'sign',
        origin: PREVIEW_ORIGIN,
        wallet: solanaWallet,
        input: { chain: 'solana', cluster: 'devnet', transaction: solanaTransfer(250_000_000n) },
        status: 'error',
        error: { code: 'policy_violation', message: 'This transaction exceeds the daily limit.' },
      },
    },
    {
      id: 'session-evm',
      label: 'Session consent, EVM with limits',
      screen: sessionScreen(evmWallet, evmSessionPolicy, now),
    },
    {
      id: 'session-solana',
      label: 'Session consent, Solana programs',
      screen: sessionScreen(solanaWallet, solanaSessionPolicy, now),
    },
    {
      id: 'session-no-limit',
      label: 'Session consent, no limit',
      screen: sessionScreen(evmWallet, unlimitedSessionPolicy, now),
    },
    {
      id: 'export',
      label: 'Export',
      screen: { name: 'export', wallet: evmWallet, status: 'idle', privateKey: null, error: null },
    },
    {
      id: 'export-simulated',
      label: 'Export, development build',
      screen: {
        name: 'export',
        wallet: evmWallet,
        status: 'simulated',
        privateKey: null,
        error: null,
      },
    },
    {
      id: 'error',
      label: 'Error',
      screen: {
        name: 'error',
        error: { code: 'internal', message: 'The Pockey API could not be reached.' },
      },
    },
  ];
}
