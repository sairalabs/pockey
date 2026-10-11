import { base58, base64, hex } from '@scure/base';
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

/**
 * Real wallet marks, so the gallery shows what a browser actually offers. At
 * runtime the wallet itself hands us its icon (EIP-6963, Wallet Standard), these
 * only stand in for the preview. Artwork from @web3icons/core (MIT).
 */
const MARKS = {
  metamask:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path fill="#FF5C16" d="m19.821 19.918-3.877-1.131-2.924 1.712h-2.04l-2.926-1.712-3.875 1.13L3 16.02l1.179-4.327L3 8.034 4.179 3.5l6.056 3.544h3.53L19.821 3.5 21 8.034l-1.179 3.658L21 16.02z"/><path fill="#FF5C16" d="m4.18 3.5 6.055 3.547-.24 2.434zm3.875 12.52 2.665 1.99-2.665.777zm2.452-3.286-.512-3.251-3.278 2.21h-.002v.001l.01 2.275 1.33-1.235zM19.82 3.5l-6.056 3.547.24 2.434zm-3.875 12.52-2.665 1.99 2.665.777zm1.339-4.326v-.002zl-3.279-2.21-.512 3.25h2.451l1.33 1.236z"/><path fill="#E34807" d="m8.054 18.787-3.875 1.13L3 16.022h5.054zm2.452-6.054.74 4.7-1.026-2.614-3.497-.85 1.33-1.236zm5.44 6.054 3.875 1.13L21 16.022h-5.055zm-2.452-6.054-.74 4.7 1.026-2.614 3.497-.85-1.331-1.236z"/><path fill="#FF8D5D" d="m3 16.02 1.179-4.328h2.535l.01 2.276 3.496.85 1.026 2.613-.527.576-2.665-1.989H3zm18 0-1.179-4.328h-2.535l-.01 2.276-3.496.85-1.026 2.613.527.576 2.665-1.989H21zm-7.235-8.976h-3.53l-.24 2.435 1.251 7.95h1.508l1.252-7.95z"/><path fill="#661800" d="M4.179 3.5 3 8.034l1.179 3.658h2.535l3.28-2.211zm5.594 10.177H8.625l-.626.6 2.222.54zM19.821 3.5 21 8.034l-1.179 3.658h-2.535l-3.28-2.211zm-5.593 10.177h1.15l.626.6-2.224.541zm-1.209 5.271.262-.94-.527-.575h-1.509l-.527.575.262.94"/><path fill="#C0C4CD" d="M13.02 18.948V20.5h-2.04v-1.552z"/><path fill="#E7EBF6" d="m8.055 18.785 2.927 1.714v-1.552l-.262-.94zm7.89 0L13.02 20.5v-1.552l.262-.94z"/></svg>',
  phantom:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path fill="#AB9FF2" d="M5.13 19.2c2.297 0 4.023-1.92 5.053-3.436a2.9 2.9 0 0 0-.195.994c0 .885.53 1.516 1.574 1.516 1.433 0 2.965-1.208 3.758-2.51a2 2 0 0 0-.083.524c0 .617.362 1.006 1.1 1.006 2.324 0 4.663-3.959 4.663-7.421C21 7.175 19.58 4.8 16.016 4.8 9.752 4.8 3 12.154 3 16.905 3 18.771 4.044 19.2 5.13 19.2m8.729-9.622c0-.671.39-1.141.96-1.141.557 0 .947.47.947 1.14 0 .672-.39 1.155-.947 1.155-.57 0-.96-.483-.96-1.154m2.979 0c0-.671.39-1.141.96-1.141.557 0 .947.47.947 1.14 0 .672-.39 1.155-.947 1.155-.57 0-.96-.483-.96-1.154"/></svg>',
  rabby:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path fill="url(#rabby__a)" d="M20.908 13.17c.707-1.644-2.788-6.235-6.127-8.148-2.105-1.482-4.298-1.279-4.742-.628-.975 1.428 3.228 2.638 6.038 4.05a3.25 3.25 0 0 0-1.508 1.39c-1.048-1.19-3.347-2.216-6.046-1.39-1.819.556-3.33 1.868-3.914 3.85a1.1 1.1 0 0 0-.464-.103c-.632 0-1.145.533-1.145 1.191s.513 1.191 1.145 1.191c.117 0 .483-.081.483-.081l5.855.044c-2.341 3.865-4.192 4.43-4.192 5.1s1.77.488 2.436.238c3.182-1.195 6.6-4.919 7.187-5.99 2.463.32 4.533.357 4.994-.715"/><path fill="url(#rabby__b)" fill-rule="evenodd" d="M16.077 8.444c.13-.053.11-.253.074-.41-.082-.362-1.5-1.82-2.833-2.473-1.815-.89-3.152-.843-3.35-.433.37.788 2.085 1.529 3.875 2.302.764.33 1.541.666 2.234 1.014" clip-rule="evenodd"/><path fill="url(#rabby__c)" fill-rule="evenodd" d="M13.774 16.38c-.367-.145-.782-.28-1.254-.4.503-.937.609-2.322.134-3.199-.666-1.229-1.503-1.883-3.446-1.883-1.07 0-3.947.374-3.998 2.874q-.009.393.018.724l5.255.04a18.7 18.7 0 0 1-1.953 2.696c.698.186 1.273.342 1.802.486.501.136.96.26 1.44.388a22 22 0 0 0 2.002-1.726" clip-rule="evenodd"/><path fill="url(#rabby__d)" d="M4.539 14.24c.215 1.898 1.252 2.642 3.371 2.863 2.12.22 3.335.072 4.954.225 1.352.128 2.559.845 3.006.598.403-.223.178-1.029-.361-1.546-.7-.67-1.667-1.135-3.369-1.3.34-.967.244-2.322-.282-3.06-.762-1.065-2.168-1.547-3.948-1.337-1.859.22-3.64 1.173-3.371 3.556"/><defs><linearGradient id="rabby__a" x1="8.311" x2="20.827" y1="11.714" y2="15.125" gradientUnits="userSpaceOnUse"><stop stop-color="#8697FF"/><stop offset="1" stop-color="#ABB7FF"/></linearGradient><linearGradient id="rabby__b" x1="18.66" x2="9.323" y1="11.468" y2="2.473" gradientUnits="userSpaceOnUse"><stop stop-color="#8697FF"/><stop offset="1" stop-color="#5156D8" stop-opacity="0"/></linearGradient><linearGradient id="rabby__c" x1="14.023" x2="5.231" y1="16.707" y2="11.849" gradientUnits="userSpaceOnUse"><stop stop-color="#465EED"/><stop offset="1" stop-color="#8697FF" stop-opacity="0"/></linearGradient><linearGradient id="rabby__d" x1="9.054" x2="15.173" y1="11.617" y2="19.089" gradientUnits="userSpaceOnUse"><stop stop-color="#8898FF"/><stop offset=".984" stop-color="#6277F1"/></linearGradient></defs></svg>',
} as const;

function markUrl(name: keyof typeof MARKS): string {
  return `data:image/svg+xml;base64,${btoa(MARKS[name])}`;
}

const walletOptions: WalletOption[] = [
  { id: 'eip6963:rabby', name: 'Rabby', icon: markUrl('rabby'), family: 'evm' },
  { id: 'injected', name: 'MetaMask', icon: markUrl('metamask'), family: 'evm' },
  { id: 'phantom:solana', name: 'Phantom', icon: markUrl('phantom'), family: 'solana' },
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
