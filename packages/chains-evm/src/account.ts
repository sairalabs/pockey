import {
  hashMessage,
  hashTypedData,
  keccak256,
  parseSignature,
  serializeTransaction,
  type Address,
  type LocalAccount,
  type TypedDataDefinition,
} from 'viem';
import { toAccount } from 'viem/accounts';
import { normalizeSignature, type SignHash } from './signing.js';

/**
 * viem `LocalAccount` whose signatures are produced by `signHash`.
 * Lets the API reuse viem wallet actions without ever holding a private key.
 * `publicKey` is not known here and is left unset.
 */
export function toPockeyAccount(options: {
  address: Address;
  signHash: SignHash;
}): LocalAccount {
  const { address, signHash } = options;
  const signDigest = async (hash: `0x${string}`) => normalizeSignature(await signHash(hash));

  return toAccount({
    address,
    async sign({ hash }) {
      return signDigest(hash);
    },
    async signMessage({ message }) {
      return signDigest(hashMessage(message));
    },
    async signTypedData(typedData) {
      return signDigest(
        hashTypedData(typedData as TypedDataDefinition<Record<string, unknown>, string>),
      );
    },
    async signTransaction(transaction, { serializer = serializeTransaction } = {}) {
      // Same as viem: EIP-4844 signs the payload body without sidecars.
      const signable =
        transaction.type === 'eip4844' ? { ...transaction, sidecars: false as const } : transaction;
      const signature = await signDigest(keccak256(await serializer(signable)));
      return serializer(transaction, parseSignature(signature));
    },
  });
}
