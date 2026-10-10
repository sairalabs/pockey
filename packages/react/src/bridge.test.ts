import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmbedBridge, type EmbedBridge } from './bridge.js';
import { PockeyEmbedError } from './errors.js';
import {
  EMBED_ORIGIN,
  EMBED_URL,
  FakeEmbed,
  flush,
  makeServerConfig,
  makeUser,
} from './__tests__/fake-embed.js';

let bridge: EmbedBridge | null = null;

function setup(options: { readyTimeoutMs?: number } = {}) {
  bridge = createEmbedBridge({
    appId: 'pk_app_x',
    embedUrl: EMBED_URL,
    init: { appearance: { theme: 'dark' }, loginMethods: ['email'] },
    ...options,
  });
  const embed = new FakeEmbed(bridge.iframe);
  embed.handle('init', () => ({ data: { user: null, config: makeServerConfig() } }));
  return { bridge, embed };
}

async function rejection(promise: Promise<unknown>): Promise<PockeyEmbedError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PockeyEmbedError) return error;
    throw error;
  }
  throw new Error('Expected the promise to reject');
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
});

afterEach(() => {
  bridge?.destroy();
  bridge = null;
  vi.useRealTimers();
});

describe('createEmbedBridge', () => {
  it('mounts a hidden, focusable iframe with the WebAuthn permissions', () => {
    const { bridge } = setup();
    const { iframe } = bridge;
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(iframe.src).toBe(`${EMBED_URL}/?appId=pk_app_x`);
    expect(iframe.title).toBe('Pockey');
    expect(iframe.getAttribute('allow')).toBe(
      'publickey-credentials-get *; publickey-credentials-create *; clipboard-write',
    );
    expect(iframe.style.getPropertyValue('position')).toBe('fixed');
    expect(iframe.style.getPropertyValue('z-index')).toBe('2147483647');
    expect(iframe.style.getPropertyValue('visibility')).toBe('hidden');
    expect(iframe.style.getPropertyValue('pointer-events')).toBe('none');
    expect(iframe.style.getPropertyValue('display')).not.toBe('none');
    expect(bridge.embedOrigin).toBe(EMBED_ORIGIN);
  });

  it('queues requests until ready, then sends init first and flushes', async () => {
    const { bridge, embed } = setup();
    const user = makeUser();
    embed.handle('login', () => ({ data: { user } }));

    const login = bridge.request('login', { method: 'email' });
    await flush();
    expect(embed.received).toHaveLength(0);

    embed.ready();
    expect(embed.received.map((request) => request.type)).toEqual(['init', 'login']);
    expect(embed.received[0]).toMatchObject({
      source: 'pockey',
      pk: 1,
      type: 'init',
      appearance: { theme: 'dark' },
      loginMethods: ['email'],
    });
    expect(embed.targetOrigins).toEqual([EMBED_ORIGIN, EMBED_ORIGIN]);
    await expect(login).resolves.toEqual({ user });
    expect(bridge.isReady()).toBe(true);
  });

  it('emits the init result', async () => {
    const { bridge, embed } = setup();
    const onInit = vi.fn();
    bridge.onInit(onInit);
    embed.ready();
    await flush();
    expect(onInit).toHaveBeenCalledWith({ user: null, config: makeServerConfig() });
  });

  it('ignores responses for unknown request ids', async () => {
    const { bridge, embed } = setup();
    embed.ready();
    embed.handle('logout', () => 'ignore');
    const settled = vi.fn();
    const logout = bridge.request('logout', {});
    void logout.then(settled, settled);

    embed.respond('unknown-request-id', { ok: true });
    await flush();
    expect(settled).not.toHaveBeenCalled();

    embed.respond(embed.last('logout').requestId, { ok: true });
    await expect(logout).resolves.toEqual({ ok: true });
  });

  it('ignores messages from the wrong origin or the wrong source', async () => {
    const { bridge, embed } = setup();
    embed.ready();
    embed.handle('logout', () => 'ignore');
    const settled = vi.fn();
    const onAuthChanged = vi.fn();
    bridge.onAuthChanged(onAuthChanged);
    void bridge.request('logout', {}).then(settled, settled);
    const { requestId } = embed.last('logout');

    const response = { type: 'response', requestId, ok: true, data: { ok: true } };
    embed.send(response, { origin: 'https://evil.example.com' });
    embed.send(response, { source: window });
    embed.send(response, { source: null });
    embed.send({ type: 'authChanged', user: null }, { origin: 'https://evil.example.com' });
    await flush();
    expect(settled).not.toHaveBeenCalled();
    expect(onAuthChanged).not.toHaveBeenCalled();

    embed.send({ type: 'authChanged', user: null });
    expect(onAuthChanged).toHaveBeenCalledWith(null);
  });

  it('ignores untagged or malformed traffic', async () => {
    const { bridge, embed } = setup();
    const onInit = vi.fn();
    bridge.onInit(onInit);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'ready' },
        origin: EMBED_ORIGIN,
        source: embed.window,
      }),
    );
    embed.send({ type: 'ready', pk: 2 });
    await flush();
    expect(bridge.isReady()).toBe(false);
    expect(embed.received).toHaveLength(0);
  });

  it('rejects with the embed error code when ok is false', async () => {
    const { bridge, embed } = setup();
    embed.ready();
    embed.handle('login', () => ({
      error: { code: 'user_rejected', message: 'The user closed the modal.' },
    }));
    const error = await rejection(bridge.request('login', {}));
    expect(error.code).toBe('user_rejected');
    expect(error.message).toBe('The user closed the modal.');
  });

  it('rejects with invalid_message when the response data does not match the schema', async () => {
    const { bridge, embed } = setup();
    embed.ready();
    embed.handle('login', () => ({ data: { user: { id: 'not-a-user' } } }));
    const error = await rejection(bridge.request('login', {}));
    expect(error.code).toBe('invalid_message');
  });

  it('rejects invalid outgoing requests without posting them', async () => {
    const { bridge, embed } = setup();
    embed.ready();
    const error = await rejection(bridge.request('login', { email: 'not an email' }));
    expect(error.code).toBe('invalid_message');
    expect(embed.requestsOf('login')).toHaveLength(0);
  });

  it('rejects queued requests with not_ready when the embed never loads', async () => {
    vi.useFakeTimers();
    const { bridge } = setup({ readyTimeoutMs: 15_000 });
    const onError = vi.fn();
    bridge.onError(onError);
    const login = rejection(bridge.request('login', {}));

    vi.advanceTimersByTime(14_999);
    expect(onError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect((await login).code).toBe('not_ready');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'not_ready' }));
    expect((await rejection(bridge.request('logout', {}))).code).toBe('not_ready');
  });

  it('shows the iframe, locks scroll and restores focus on visibility changes', () => {
    const { bridge, embed } = setup();
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    document.body.style.overflow = 'auto';
    const onVisibility = vi.fn();
    bridge.onVisibility(onVisibility);

    embed.send({ type: 'visibility', visible: true });
    expect(bridge.iframe.style.getPropertyValue('visibility')).toBe('visible');
    expect(bridge.iframe.style.getPropertyValue('pointer-events')).toBe('auto');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(bridge.iframe);
    expect(bridge.isVisible()).toBe(true);

    embed.send({ type: 'visibility', visible: false });
    expect(bridge.iframe.style.getPropertyValue('visibility')).toBe('hidden');
    expect(bridge.iframe.style.getPropertyValue('pointer-events')).toBe('none');
    expect(document.body.style.overflow).toBe('auto');
    expect(document.activeElement).toBe(button);
    expect(onVisibility.mock.calls).toEqual([[true], [false]]);
  });

  it('destroy removes the iframe, unlocks scroll and rejects pending requests', async () => {
    const { bridge, embed } = setup();
    embed.ready();
    embed.handle('login', () => 'ignore');
    embed.send({ type: 'visibility', visible: true });
    const login = rejection(bridge.request('login', {}));

    bridge.destroy();
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
    expect(document.body.style.overflow).toBe('');
    expect((await login).code).toBe('not_ready');
    expect((await rejection(bridge.request('logout', {}))).code).toBe('not_ready');
  });
});
