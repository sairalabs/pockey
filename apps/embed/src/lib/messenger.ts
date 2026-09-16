import {
  EMBED_MESSAGE_TAG,
  EMBED_PROTOCOL_VERSION,
  HostRequest,
  type EmbedError,
  type EmbedMessage,
  type EndUser,
  type PublicAppConfig,
} from '@pocketkey/types';
import { toEmbedError } from './errors';
import { isRecord } from './guards';

/** The fields of a `MessageEvent` the messenger reads. */
export interface IncomingMessage {
  data: unknown;
  origin: string;
  source: unknown;
}

export interface MessageTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface RequestContext {
  /** Sender origin, already checked against the allowlist. */
  origin: string;
  /** The raw payload, before Zod applied defaults. */
  raw: unknown;
}

export interface MessengerDeps {
  /** `window.parent`. Messages from any other source are ignored. */
  parent: MessageTarget;
  listen: (listener: (event: IncomingMessage) => void) => () => void;
  getConfig: () => Promise<PublicAppConfig>;
  handle: (request: HostRequest, context: RequestContext) => Promise<unknown>;
  onAuthChange?: (listener: (user: EndUser | null) => void) => () => void;
}

export interface Messenger {
  /** Loads the config, starts listening and announces `ready`. */
  start: () => Promise<void>;
  /** Posts `visibility` when it changes. No-op before the host is known. */
  setVisible: (visible: boolean) => void;
  hostOrigin: () => string | null;
  stop: () => void;
}

const envelope = { source: EMBED_MESSAGE_TAG, pk: EMBED_PROTOCOL_VERSION } as const;

export function createMessenger(deps: MessengerDeps): Messenger {
  let allowed = new Set<string>();
  let host: string | null = null;
  let visible = false;
  let started = false;
  const cleanups: (() => void)[] = [];

  const post = (message: EmbedMessage, targetOrigin: string) => {
    try {
      deps.parent.postMessage(message, targetOrigin);
    } catch (error) {
      // A malformed origin throws a SyntaxError; nothing to deliver then.
      console.error('[pocketkey] postMessage failed', error);
    }
  };

  const respond = (
    targetOrigin: string,
    requestId: string,
    result: { ok: true; data: unknown } | { ok: false; error: EmbedError },
  ) => {
    post(
      result.ok
        ? { ...envelope, type: 'response', requestId, ok: true, data: result.data }
        : { ...envelope, type: 'response', requestId, ok: false, error: result.error },
      targetOrigin,
    );
  };

  const onMessage = (event: IncomingMessage) => {
    if (event.source !== deps.parent) return;
    const data = event.data;
    if (!isRecord(data) || data.source !== EMBED_MESSAGE_TAG) return;
    if (!allowed.has(event.origin)) return;
    if (host !== null && event.origin !== host) return;

    const parsed = HostRequest.safeParse(data);
    if (!parsed.success) {
      const requestId = data.requestId;
      if (typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 64) {
        respond(event.origin, requestId, {
          ok: false,
          error: { code: 'invalid_message', message: 'Malformed Pocketkey request.' },
        });
      }
      return;
    }

    host ??= event.origin;
    const origin = host;
    const request = parsed.data;
    let pending: Promise<unknown>;
    try {
      pending = deps.handle(request, { origin, raw: data });
    } catch (error) {
      pending = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    pending.then(
      (result) => {
        respond(origin, request.requestId, { ok: true, data: result });
      },
      (error: unknown) => {
        respond(origin, request.requestId, { ok: false, error: toEmbedError(error) });
      },
    );
  };

  return {
    async start() {
      if (started) return;
      started = true;
      let config: PublicAppConfig;
      try {
        config = await deps.getConfig();
      } catch (error) {
        started = false;
        throw error;
      }
      allowed = new Set(config.allowedOrigins);
      cleanups.push(deps.listen(onMessage));
      if (deps.onAuthChange) {
        cleanups.push(
          deps.onAuthChange((user) => {
            if (host !== null) post({ ...envelope, type: 'authChanged', user }, host);
          }),
        );
      }
      // Only the real parent receives it: the browser drops a non-matching targetOrigin.
      for (const origin of allowed) post({ ...envelope, type: 'ready' }, origin);
    },
    setVisible(next) {
      if (host === null || next === visible) return;
      visible = next;
      post({ ...envelope, type: 'visibility', visible: next }, host);
    },
    hostOrigin: () => host,
    stop() {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}
