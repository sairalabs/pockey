/**
 * @pocketkey/gas-sponsor (private, server side)
 *
 * Gas sponsoring port (section 7.5, T4.4 and T4.5). Solana: per-app fee payer
 * co-signature with strict safety checks. EVM: ERC-4337 Kernel smart account with
 * a Pimlico bundler and paymaster. Pricing turns native costs into prepaid cents
 * (real cost plus `SPONSOR_MARGIN`). Runs on Workers: WebCrypto and fetch only.
 */
export { GasSponsorError, type GasSponsorErrorCode } from './errors.js';
export {
  chargedCents,
  createCoinGeckoPriceFeed,
  createStaticPriceFeed,
  NATIVE_ASSETS,
  nativeAssetFor,
  type NativeAsset,
  type PriceFeed,
} from './pricing.js';
export {
  DEFAULT_SOLANA_SPONSOR_POLICY,
  sponsorSolanaTransaction,
  validateSponsoredSolanaTransaction,
  type SolanaSigner,
  type SolanaSponsorPolicy,
} from './solana.js';
export {
  createEvmGasSponsor,
  DEFAULT_RECEIPT_TIMEOUT_MS,
  maxGasCostWei,
  type EvmCall,
  type EvmGasSponsor,
  type EvmOwner,
  type EvmSponsorClientsFactory,
  type PreparedUserOperation,
  type UserOperationReceiptSummary,
} from './evm.js';
export {
  createPimlicoClientsFactory,
  createPimlicoEvmSponsor,
  ENTRY_POINT,
  KERNEL_VERSION,
  pimlicoUrl,
} from './pimlico.js';
