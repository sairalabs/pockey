import {
  EMBED_APP_ID_PARAM,
  EMBED_MESSAGE_TAG,
  EMBED_PROTOCOL_VERSION,
  EmbedMessage,
  HostRequest,
  HostResponseData,
  type Appearance,
  type EndUser,
  type HostRequestType,
  type HostResponseDataMap,
  type LoginMethod,
} from '@pocketkey/types';
import type { z } from 'zod';
import { PocketkeyEmbedError } from './errors.js';

/** Framework-free bridge to the embed iframe (section 4.1). Never talks to the API. */

type HostRequestInput = z.input<typeof HostRequest>;

/** Request fields a caller provides; the envelope (`source`, `pk`, `requestId`, `type`) is added by the bridge. */
export type HostRequestPayload<T extends HostRequestType> = Omit<
  Extract<HostRequestInput, { type: T }>,
  'source' | 'pk' | 'requestId' | 'type'
>;

export interface EmbedInitOptions {
  appearance?: Partial<Appearance>;
  loginMethods?: LoginMethod[];
}

export interface EmbedBridgeOptions {
  appId: string;
  embedUrl: string;
  /** Where the iframe is appended. Defaults to `document.body`. */
  container?: HTMLElement;
  /** Host overrides sent with the `init` request. */
  init?: EmbedInitOptions;
  /** How long to wait for the embed `ready` event. Defaults to 15 s. */
  readyTimeoutMs?: number;
}

export interface EmbedBridge {
  readonly iframe: HTMLIFrameElement;
  readonly embedOrigin: string;
  isReady(): boolean;
  isVisible(): boolean;
  request<T extends HostRequestType>(
    type: T,
    payload: HostRequestPayload<T>,
  ): Promise<HostResponseDataMap[T]>;
  /** Called every time the embed answers `init` (after each `ready`). */
  onInit(listener: (result: HostResponseDataMap['init']) => void): () => void;
  onAuthChanged(listener: (user: EndUser | null) => void): () => void;
  onVisibility(listener: (visible: boolean) => void): () => void;
  /** Bridge-level failures: ready timeout, rejected `init`. */
  onError(listener: (error: PocketkeyEmbedError) => void): () => void;
  destroy(): void;
}

export const READY_TIMEOUT_MS = 15_000;

const IFRAME_STYLE: Partial<Record<string, string>> = {
  position: 'fixed',
  inset: '0',
  width: '100%',
  height: '100%',
  border: '0',
  'z-index': '2147483647',
  background: 'transparent',
  'color-scheme': 'normal',
};

interface Pending {
  type: HostRequestType;
  resolve: (data: unknown) => void;
  reject: (error: PocketkeyEmbedError) => void;
}

let requestCounter = 0;
function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  requestCounter += 1;
  return `req_${Date.now().toString(36)}_${requestCounter.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createListeners<Args extends unknown[]>() {
  const set = new Set<(...args: Args) => void>();
  return {
    add: (listener: (...args: Args) => void): (() => void) => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    emit: (...args: Args): void => {
      for (const listener of [...set]) listener(...args);
    },
    clear: (): void => {
      set.clear();
    },
  };
}

export function createEmbedBridge(options: EmbedBridgeOptions): EmbedBridge {
  const embedOrigin = new URL(options.embedUrl).origin;
  const src = `${options.embedUrl.replace(/\/+$/, '')}/?${EMBED_APP_ID_PARAM}=${encodeURIComponent(options.appId)}`;

  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.title = 'Pocketkey';
  iframe.setAttribute(
    'allow',
    'publickey-credentials-get *; publickey-credentials-create *; clipboard-write',
  );
  for (const [property, value] of Object.entries(IFRAME_STYLE)) {
    if (value !== undefined) iframe.style.setProperty(property, value);
  }
  // Hidden with visibility, never display:none: a display:none iframe loses WebAuthn and focus.
  // No host-side transition: the embed animates its own dialog and honors prefers-reduced-motion.
  iframe.style.setProperty('visibility', 'hidden');
  iframe.style.setProperty('pointer-events', 'none');

  let state: 'loading' | 'ready' | 'timed_out' | 'destroyed' = 'loading';
  let visible = false;
  let previousFocus: Element | null = null;
  let savedBodyStyle: { overflow: string; paddingRight: string } | null = null;

  const pending = new Map<string, Pending>();
  const queue: HostRequest[] = [];

  const initListeners = createListeners<[HostResponseDataMap['init']]>();
  const authListeners = createListeners<[EndUser | null]>();
  const visibilityListeners = createListeners<[boolean]>();
  const errorListeners = createListeners<[PocketkeyEmbedError]>();

  const post = (message: HostRequest) => {
    iframe.contentWindow?.postMessage(message, embedOrigin);
  };

  const rejectAll = (error: PocketkeyEmbedError) => {
    const entries = [...pending.values()];
    pending.clear();
    for (const entry of entries) entry.reject(error);
  };

  const request = <T extends HostRequestType>(
    type: T,
    payload: HostRequestPayload<T>,
  ): Promise<HostResponseDataMap[T]> =>
    new Promise<HostResponseDataMap[T]>((resolve, reject) => {
      if (state === 'destroyed' || state === 'timed_out') {
        reject(new PocketkeyEmbedError('not_ready', 'The Pocketkey embed is not available.'));
        return;
      }
      const requestId = newRequestId();
      const parsed = HostRequest.safeParse({
        ...payload,
        source: EMBED_MESSAGE_TAG,
        pk: EMBED_PROTOCOL_VERSION,
        requestId,
        type,
      });
      if (!parsed.success) {
        reject(
          new PocketkeyEmbedError(
            'invalid_message',
            `Invalid ${type} request: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
          ),
        );
        return;
      }
      pending.set(requestId, {
        type,
        resolve: (data) => {
          resolve(data as HostResponseDataMap[T]);
        },
        reject,
      });
      if (state === 'ready') post(parsed.data);
      else queue.push(parsed.data);
    });

  const sendInit = () => {
    const init = options.init ?? {};
    const payload: HostRequestPayload<'init'> = {};
    if (init.appearance && Object.keys(init.appearance).length > 0)
      payload.appearance = init.appearance;
    if (init.loginMethods && init.loginMethods.length > 0) payload.loginMethods = init.loginMethods;
    request('init', payload).then(
      (result) => {
        initListeners.emit(result);
      },
      (error: unknown) => {
        if (error instanceof PocketkeyEmbedError && state !== 'destroyed')
          errorListeners.emit(error);
      },
    );
  };

  const lockScroll = () => {
    const body = document.body;
    const root = document.documentElement;
    savedBodyStyle = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const scrollbarWidth =
      root.clientWidth > 0 ? Math.max(0, window.innerWidth - root.clientWidth) : 0;
    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    }
    body.style.overflow = 'hidden';
  };

  const unlockScroll = () => {
    if (!savedBodyStyle) return;
    document.body.style.overflow = savedBodyStyle.overflow;
    document.body.style.paddingRight = savedBodyStyle.paddingRight;
    savedBodyStyle = null;
  };

  const setVisible = (next: boolean) => {
    if (next === visible) return;
    visible = next;
    if (next) {
      previousFocus = document.activeElement;
      iframe.style.setProperty('visibility', 'visible');
      iframe.style.setProperty('pointer-events', 'auto');
      lockScroll();
      iframe.focus();
    } else {
      iframe.style.setProperty('visibility', 'hidden');
      iframe.style.setProperty('pointer-events', 'none');
      unlockScroll();
      const target = previousFocus;
      previousFocus = null;
      if (target instanceof HTMLElement && target.isConnected && target !== document.body) {
        target.focus({ preventScroll: true });
      } else if (document.activeElement === iframe) {
        iframe.blur();
      }
    }
    visibilityListeners.emit(next);
  };

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== embedOrigin) return;
    if (iframe.contentWindow === null || event.source !== iframe.contentWindow) return;
    const parsed = EmbedMessage.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;

    switch (message.type) {
      case 'ready': {
        if (state === 'destroyed') return;
        clearTimeout(readyTimer);
        if (state === 'ready') {
          // The embed reloaded: requests sent to the previous document will never be answered.
          rejectAll(new PocketkeyEmbedError('not_ready', 'The Pocketkey embed reloaded.'));
        }
        state = 'ready';
        sendInit();
        for (const queued of queue.splice(0)) post(queued);
        return;
      }
      case 'visibility': {
        setVisible(message.visible);
        return;
      }
      case 'authChanged': {
        authListeners.emit(message.user);
        return;
      }
      case 'response': {
        const entry = pending.get(message.requestId);
        if (!entry) return;
        pending.delete(message.requestId);
        if (!message.ok) {
          entry.reject(
            new PocketkeyEmbedError(
              message.error?.code ?? 'internal',
              message.error?.message ?? `The ${entry.type} request failed.`,
            ),
          );
          return;
        }
        const data = HostResponseData[entry.type].safeParse(message.data);
        if (!data.success) {
          entry.reject(
            new PocketkeyEmbedError(
              'invalid_message',
              `Malformed ${entry.type} response from the embed.`,
            ),
          );
          return;
        }
        entry.resolve(data.data);
        return;
      }
    }
  };

  const readyTimer = setTimeout(() => {
    if (state !== 'loading') return;
    state = 'timed_out';
    queue.length = 0;
    const error = new PocketkeyEmbedError(
      'not_ready',
      `The Pocketkey embed did not load within ${options.readyTimeoutMs ?? READY_TIMEOUT_MS} ms.`,
    );
    rejectAll(error);
    errorListeners.emit(error);
  }, options.readyTimeoutMs ?? READY_TIMEOUT_MS);

  window.addEventListener('message', onMessage);
  (options.container ?? document.body).appendChild(iframe);

  return {
    iframe,
    embedOrigin,
    isReady: () => state === 'ready',
    isVisible: () => visible,
    request,
    onInit: initListeners.add,
    onAuthChanged: authListeners.add,
    onVisibility: visibilityListeners.add,
    onError: errorListeners.add,
    destroy() {
      if (state === 'destroyed') return;
      clearTimeout(readyTimer);
      if (visible) setVisible(false);
      state = 'destroyed';
      window.removeEventListener('message', onMessage);
      queue.length = 0;
      rejectAll(new PocketkeyEmbedError('not_ready', 'The Pocketkey provider was unmounted.'));
      iframe.remove();
      initListeners.clear();
      authListeners.clear();
      visibilityListeners.clear();
      errorListeners.clear();
    },
  };
}
