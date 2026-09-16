import { z } from 'zod';
import { PocketkeyError, type PocketkeyErrorCode } from './errors.js';

export const OAUTH_POPUP_TIMEOUT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 500;

/** What `/v1/auth/oauth/:appId/complete` posts to `window.opener`. */
const OAuthMessage = z.union([
  z.object({ type: z.literal('pocketkey:oauth'), code: z.string().min(16).max(128) }),
  z.object({ type: z.literal('pocketkey:oauth'), error: z.string().min(1).max(64) }),
]);

/** The slice of `Window` the popup flow needs, so tests can fake it. */
export interface PopupHost {
  open(url: string, target: string, features: string): PopupWindow | null;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export interface PopupWindow {
  readonly closed: boolean;
  close(): void;
}

export function popupHost(): PopupHost | null {
  try {
    const host = (globalThis as { window?: unknown }).window;
    if (
      typeof host === 'object' &&
      host !== null &&
      typeof (host as Partial<PopupHost>).open === 'function' &&
      typeof (host as Partial<PopupHost>).addEventListener === 'function'
    ) {
      return host as PopupHost;
    }
  } catch {
    // Fall through.
  }
  return null;
}

function popupFeatures(): string {
  const width = 500;
  const height = 640;
  const g = globalThis as {
    screenX?: number;
    screenY?: number;
    outerWidth?: number;
    outerHeight?: number;
  };
  const left = Math.max(0, (g.screenX ?? 0) + ((g.outerWidth ?? width) - width) / 2);
  const top = Math.max(0, (g.screenY ?? 0) + ((g.outerHeight ?? height) - height) / 2);
  return `popup,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`;
}

/** Opens the popup synchronously. Returns null when the browser blocked it. */
export function openPopup(host: PopupHost, url: string): PopupWindow | null {
  try {
    return host.open(url, 'pocketkey-oauth', popupFeatures());
  } catch {
    return null;
  }
}

function providerErrorCode(error: string): PocketkeyErrorCode {
  if (error === 'access_denied') return 'user_rejected';
  if (error === 'unknown_app') return 'app_id_invalid';
  return 'unauthorized';
}

/**
 * Resolves with the one-time exchange code posted by the popup. Only messages
 * from `expectedOrigin` and from this very popup are considered.
 */
export function waitForOAuthCode(
  host: PopupHost,
  popup: PopupWindow,
  options: { expectedOrigin: string; timeoutMs: number },
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let closedPolls = 0;

    const cleanup = () => {
      host.removeEventListener('message', onMessage);
      clearInterval(poll);
      clearTimeout(timer);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== options.expectedOrigin) return;
      if (event.source !== (popup as unknown)) return;
      const parsed = OAuthMessage.safeParse(event.data);
      if (!parsed.success) return;
      cleanup();
      if ('code' in parsed.data) {
        resolve(parsed.data.code);
        return;
      }
      const error = parsed.data.error;
      reject(
        new PocketkeyError(providerErrorCode(error), `OAuth sign-in failed: ${error}`, {
          details: { providerError: error },
        }),
      );
    };

    const poll = setInterval(() => {
      let closed: boolean;
      try {
        closed = popup.closed;
      } catch {
        closed = false;
      }
      if (!closed) return;
      // The popup posts then closes itself: give the queued message one more poll to land.
      closedPolls += 1;
      if (closedPolls < 2) return;
      cleanup();
      reject(new PocketkeyError('user_rejected', 'The sign-in popup was closed'));
    }, POLL_INTERVAL_MS);

    const timer = setTimeout(() => {
      cleanup();
      try {
        popup.close();
      } catch {
        // Cross-origin close can throw in old browsers.
      }
      reject(
        new PocketkeyError('user_rejected', 'The sign-in popup timed out', {
          details: { reason: 'timeout' },
        }),
      );
    }, options.timeoutMs);

    host.addEventListener('message', onMessage);
  });
}
