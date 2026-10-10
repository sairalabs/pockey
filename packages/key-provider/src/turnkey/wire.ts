/**
 * The subset of the Turnkey public API Pockey speaks, as plain data.
 *
 * Checked against `@turnkey/http` 6.5 generated types and a live organization on
 * 2026-09-19 (see TURNKEY.md). Kept as our own definitions so the Worker, the
 * iframe and the emulator share one vocabulary without bundling the SDK.
 */

export const TURNKEY_API_BASE_URL = 'https://api.turnkey.com';

export const ACTIVITY = {
  createSubOrganization: 'ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8',
  deleteSubOrganization: 'ACTIVITY_TYPE_DELETE_SUB_ORGANIZATION',
  createWallet: 'ACTIVITY_TYPE_CREATE_WALLET',
  createUsers: 'ACTIVITY_TYPE_CREATE_USERS_V4',
  createPolicy: 'ACTIVITY_TYPE_CREATE_POLICY_V3',
  deletePolicy: 'ACTIVITY_TYPE_DELETE_POLICY',
  signRawPayload: 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2',
  signTransaction: 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2',
  exportWallet: 'ACTIVITY_TYPE_EXPORT_WALLET',
  exportWalletAccount: 'ACTIVITY_TYPE_EXPORT_WALLET_ACCOUNT',
  initOtp: 'ACTIVITY_TYPE_INIT_OTP_V3',
  verifyOtp: 'ACTIVITY_TYPE_VERIFY_OTP_V2',
  otpLogin: 'ACTIVITY_TYPE_OTP_LOGIN_V2',
  oauthLogin: 'ACTIVITY_TYPE_OAUTH_LOGIN',
  stampLogin: 'ACTIVITY_TYPE_STAMP_LOGIN',
  createAuthenticators: 'ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2',
  createApiKeys: 'ACTIVITY_TYPE_CREATE_API_KEYS_V2',
} as const;
export type ActivityType = (typeof ACTIVITY)[keyof typeof ACTIVITY];

/** Submit path of each activity. */
export const ACTIVITY_PATH: Record<ActivityType, string> = {
  [ACTIVITY.createSubOrganization]: '/public/v1/submit/create_sub_organization',
  [ACTIVITY.deleteSubOrganization]: '/public/v1/submit/delete_sub_organization',
  [ACTIVITY.createWallet]: '/public/v1/submit/create_wallet',
  [ACTIVITY.createUsers]: '/public/v1/submit/create_users',
  [ACTIVITY.createPolicy]: '/public/v1/submit/create_policy',
  [ACTIVITY.deletePolicy]: '/public/v1/submit/delete_policy',
  [ACTIVITY.signRawPayload]: '/public/v1/submit/sign_raw_payload',
  [ACTIVITY.signTransaction]: '/public/v1/submit/sign_transaction',
  [ACTIVITY.exportWallet]: '/public/v1/submit/export_wallet',
  [ACTIVITY.exportWalletAccount]: '/public/v1/submit/export_wallet_account',
  [ACTIVITY.initOtp]: '/public/v1/submit/init_otp',
  [ACTIVITY.verifyOtp]: '/public/v1/submit/verify_otp',
  [ACTIVITY.otpLogin]: '/public/v1/submit/otp_login',
  [ACTIVITY.oauthLogin]: '/public/v1/submit/oauth_login',
  [ACTIVITY.stampLogin]: '/public/v1/submit/stamp_login',
  [ACTIVITY.createAuthenticators]: '/public/v1/submit/create_authenticators',
  [ACTIVITY.createApiKeys]: '/public/v1/submit/create_api_keys',
};

export const QUERY_PATH = {
  whoami: '/public/v1/query/whoami',
  getActivity: '/public/v1/query/get_activity',
} as const;

export interface ActivityBody<P = Record<string, unknown>> {
  type: ActivityType;
  /** Milliseconds since epoch, as a string. Turnkey rejects stale stamps. */
  timestampMs: string;
  organizationId: string;
  parameters: P;
}

export type ActivityStatus =
  | 'ACTIVITY_STATUS_CREATED'
  | 'ACTIVITY_STATUS_PENDING'
  | 'ACTIVITY_STATUS_COMPLETED'
  | 'ACTIVITY_STATUS_FAILED'
  | 'ACTIVITY_STATUS_CONSENSUS_NEEDED'
  | 'ACTIVITY_STATUS_REJECTED';

export interface ActivityResponse {
  activity: {
    id: string;
    organizationId: string;
    status: ActivityStatus;
    type: string;
    /** One key, named after the result version (`createWalletResult`, ...). */
    result?: Record<string, unknown>;
    failure?: { code?: number; message?: string };
  };
}

/** Turnkey error body (gRPC style codes). */
export interface TurnkeyErrorBody {
  code?: number;
  message?: string;
  details?: unknown[];
}

export const GRPC = {
  invalidArgument: 3,
  notFound: 5,
  permissionDenied: 7,
  resourceExhausted: 8,
  failedPrecondition: 9,
  unauthenticated: 16,
} as const;

/* Parameters we build. Field names follow the Turnkey API exactly. */

export type ApiKeyCurve =
  'API_KEY_CURVE_P256' | 'API_KEY_CURVE_SECP256K1' | 'API_KEY_CURVE_ED25519';

export interface ApiKeyParams {
  apiKeyName: string;
  publicKey: string;
  curveType: ApiKeyCurve;
  expirationSeconds?: string;
}

export interface AuthenticatorParams {
  authenticatorName: string;
  challenge: string;
  attestation: {
    credentialId: string;
    clientDataJson: string;
    attestationObject: string;
    transports: string[];
  };
}

export interface OauthProviderParams {
  providerName: string;
  oidcToken: string;
}

export interface RootUserParams {
  userName: string;
  userEmail?: string;
  apiKeys: ApiKeyParams[];
  authenticators: AuthenticatorParams[];
  oauthProviders: OauthProviderParams[];
}

export interface ClientSignature {
  publicKey: string;
  scheme: 'CLIENT_SIGNATURE_SCHEME_API_P256';
  message: string;
  signature: string;
}

export const WALLET_ACCOUNT = {
  evm: {
    curve: 'CURVE_SECP256K1',
    pathFormat: 'PATH_FORMAT_BIP32',
    path: "m/44'/60'/0'/0/0",
    addressFormat: 'ADDRESS_FORMAT_ETHEREUM',
  },
  solana: {
    curve: 'CURVE_ED25519',
    pathFormat: 'PATH_FORMAT_BIP32',
    path: "m/44'/501'/0'/0'",
    addressFormat: 'ADDRESS_FORMAT_SOLANA',
  },
} as const;

/** Reads the single versioned result of a completed activity. Callers validate its shape. */
export function activityResult(response: ActivityResponse, prefix: string): unknown {
  const entry = Object.entries(response.activity.result ?? {}).find(([key]) =>
    key.startsWith(prefix),
  );
  if (!entry) throw new Error(`Turnkey activity has no ${prefix}* result`);
  return entry[1];
}
