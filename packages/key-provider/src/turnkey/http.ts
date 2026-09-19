import { KeyProviderError } from '../index.js';
import type { Stamp, Stamper } from './stamp.js';
import {
  ACTIVITY_PATH,
  GRPC,
  QUERY_PATH,
  type ActivityBody,
  type ActivityResponse,
  type ActivityType,
  type TurnkeyErrorBody,
} from './wire.js';

/**
 * Transport to Turnkey: the real HTTPS API, or the in-memory emulator in tests
 * and local development. Both receive the exact body string that was stamped.
 */
export interface TurnkeyTransport {
  send(path: string, body: string, stamp: Stamp): Promise<unknown>;
}

/** Raised by transports with the Turnkey error body, mapped to `KeyProviderError` by `toProviderError`. */
export class TurnkeyRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: TurnkeyErrorBody,
  ) {
    super(body.message ?? `Turnkey request failed with HTTP ${status}`);
    this.name = 'TurnkeyRequestError';
  }
}

export interface HttpTransportOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createHttpTransport(options: HttpTransportOptions): TurnkeyTransport {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 20_000;
  return {
    async send(path, body, stamp) {
      let response: Response;
      try {
        response = await doFetch(new URL(path, options.baseUrl).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [stamp.header]: stamp.value },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw new KeyProviderError('Turnkey is unreachable', 'provider_unavailable', { cause });
      }
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // Non JSON error page (gateway), handled below.
      }
      if (!response.ok) {
        const errorBody: TurnkeyErrorBody =
          json && typeof json === 'object' ? json : { message: text.slice(0, 200) };
        throw new TurnkeyRequestError(response.status, errorBody);
      }
      return json;
    },
  };
}

/** Maps a transport failure to the port error. Messages never include request bodies. */
export function toProviderError(error: unknown): KeyProviderError {
  if (error instanceof KeyProviderError) return error;
  if (error instanceof TurnkeyRequestError) {
    const message = `Turnkey: ${(error.body.message ?? error.message).slice(0, 300)}`;
    switch (error.body.code) {
      case GRPC.permissionDenied:
        return new KeyProviderError(message, 'policy_denied', { cause: error });
      case GRPC.unauthenticated:
        return new KeyProviderError(message, 'unauthenticated', { cause: error });
      case GRPC.notFound:
        return new KeyProviderError(message, 'not_found', { cause: error });
      case GRPC.invalidArgument:
      case GRPC.failedPrecondition:
        return new KeyProviderError(message, 'invalid_input', { cause: error });
      case GRPC.resourceExhausted:
        return new KeyProviderError(message, 'provider_unavailable', { cause: error });
      default:
        return new KeyProviderError(
          message,
          error.status >= 500 ? 'provider_unavailable' : 'unknown',
          { cause: error },
        );
    }
  }
  return new KeyProviderError('Unexpected key provider failure', 'unknown', { cause: error });
}

export interface TurnkeyClientOptions {
  transport: TurnkeyTransport;
  /** Polls a pending activity this many times, `pollIntervalMs` apart. */
  pollAttempts?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SubmitOptions {
  /**
   * Epoch ms until which a not found or permission denied answer is retried,
   * for resources created just before (wallet, delegated user, session policy).
   * Leave unset otherwise: a real refusal should fail fast.
   */
  retryUntil?: number;
}

const PROPAGATION_RETRY_MS = 400;

/** How long a freshly created Turnkey resource may take to become visible. */
export const PROPAGATION_WINDOW_MS = 5_000;

export interface PreparedActivity {
  path: string;
  body: string;
}

/** Builds the exact body a credential holder must stamp. */
export function prepareActivity(
  type: ActivityType,
  organizationId: string,
  parameters: object,
  now: () => number = Date.now,
): PreparedActivity {
  const body: ActivityBody<object> = {
    type,
    timestampMs: String(now()),
    organizationId,
    parameters,
  };
  return { path: ACTIVITY_PATH[type], body: JSON.stringify(body) };
}

export class TurnkeyClient {
  private readonly transport: TurnkeyTransport;
  private readonly pollAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: TurnkeyClientOptions) {
    this.transport = options.transport;
    this.pollAttempts = options.pollAttempts ?? 10;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Builds, stamps and runs an activity with a credential held here. */
  async activity(
    type: ActivityType,
    organizationId: string,
    parameters: object,
    stamper: Stamper,
    options: SubmitOptions = {},
  ): Promise<ActivityResponse> {
    const prepared = prepareActivity(type, organizationId, parameters, this.now);
    const stamp = await stamper.stamp(prepared.body);
    return this.submit(prepared.path, prepared.body, stamp, { ...options, pollStamper: stamper });
  }

  /**
   * Runs an activity stamped elsewhere (the iframe). `pollStamper` signs the
   * status queries if the activity is still pending; a relayed stamp cannot be
   * reused for another body.
   */
  async submit(
    path: string,
    body: string,
    stamp: Stamp,
    options: SubmitOptions & { pollStamper?: Stamper } = {},
  ): Promise<ActivityResponse> {
    let response: ActivityResponse;
    for (;;) {
      try {
        response = (await this.transport.send(path, body, stamp)) as ActivityResponse;
        break;
      } catch (error) {
        // Turnkey is eventually consistent: a wallet, user or policy created a
        // moment ago can be missing for about a second (measured 2026-09-19).
        // A refused request ran nothing, so sending the same stamped body again is safe.
        const propagating =
          error instanceof TurnkeyRequestError &&
          (error.body.code === GRPC.notFound || error.body.code === GRPC.permissionDenied);
        if (!propagating || options.retryUntil === undefined || this.now() >= options.retryUntil) {
          throw toProviderError(error);
        }
        await this.sleep(PROPAGATION_RETRY_MS);
      }
    }
    return this.settle(response, options.pollStamper);
  }

  async query<T>(path: string, parameters: Record<string, unknown>, stamper: Stamper): Promise<T> {
    const body = JSON.stringify(parameters);
    try {
      return (await this.transport.send(path, body, await stamper.stamp(body))) as T;
    } catch (error) {
      throw toProviderError(error);
    }
  }

  private async settle(
    response: ActivityResponse,
    pollStamper?: Stamper,
  ): Promise<ActivityResponse> {
    let current = response;
    for (let attempt = 0; ; attempt++) {
      const { status } = current.activity;
      if (status === 'ACTIVITY_STATUS_COMPLETED') return current;
      if (status === 'ACTIVITY_STATUS_FAILED' || status === 'ACTIVITY_STATUS_REJECTED') {
        throw new KeyProviderError(
          `Turnkey activity ${status === 'ACTIVITY_STATUS_REJECTED' ? 'rejected' : 'failed'}: ${(current.activity.failure?.message ?? 'no reason').slice(0, 300)}`,
          status === 'ACTIVITY_STATUS_REJECTED' ? 'policy_denied' : 'unknown',
        );
      }
      if (status === 'ACTIVITY_STATUS_CONSENSUS_NEEDED') {
        // Our sub-organizations have a quorum of one, so this means the credential
        // is not allowed to act alone: treat it as a policy refusal.
        throw new KeyProviderError('Turnkey activity needs more approvals', 'policy_denied');
      }
      if (!pollStamper || attempt >= this.pollAttempts) {
        throw new KeyProviderError('Turnkey activity is still pending', 'provider_unavailable');
      }
      await this.sleep(this.pollIntervalMs);
      current = await this.query<ActivityResponse>(
        QUERY_PATH.getActivity,
        { organizationId: current.activity.organizationId, activityId: current.activity.id },
        pollStamper,
      );
    }
  }
}
