import type { HostRequest, PublicAppConfig } from '@pockey/types';
import { describe, expect, it, vi } from 'vitest';
import { EmbedFailure } from './errors';
import { createMessenger, type IncomingMessage, type RequestContext } from './messenger';

const HOST = 'https://app.example';
const OTHER = 'https://other.example';

async function setup(handle?: (request: HostRequest, context: RequestContext) => Promise<unknown>) {
  const parent = { postMessage: vi.fn<(message: unknown, targetOrigin: string) => void>() };
  const holder: { listener?: (event: IncomingMessage) => void } = {};
  const handler = vi.fn(handle ?? (async () => ({ user: null })));
  const messenger = createMessenger({
    parent,
    listen(listener) {
      holder.listener = listener;
      return () => {
        delete holder.listener;
      };
    },
    getConfig: async () => ({ allowedOrigins: [HOST, OTHER] }) as unknown as PublicAppConfig,
    handle: handler,
  });
  await messenger.start();
  parent.postMessage.mockClear();
  const send = (data: unknown, origin = HOST, source: unknown = parent) => {
    holder.listener?.({ data, origin, source });
  };
  return { parent, messenger, send, handler };
}

const request = (extra: Record<string, unknown> = {}) => ({
  source: 'pockey',
  pk: 1,
  requestId: 'req-1',
  type: 'getUser',
  ...extra,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('messenger', () => {
  it('announces ready once per allowed origin, with that exact targetOrigin', async () => {
    const parent = { postMessage: vi.fn<(message: unknown, targetOrigin: string) => void>() };
    const messenger = createMessenger({
      parent,
      listen: () => () => undefined,
      getConfig: async () => ({ allowedOrigins: [HOST, OTHER] }) as unknown as PublicAppConfig,
      handle: async () => null,
    });
    await messenger.start();
    await messenger.start();
    expect(parent.postMessage).toHaveBeenCalledTimes(2);
    expect(parent.postMessage).toHaveBeenNthCalledWith(
      1,
      { source: 'pockey', pk: 1, type: 'ready' },
      HOST,
    );
    expect(parent.postMessage).toHaveBeenNthCalledWith(
      2,
      { source: 'pockey', pk: 1, type: 'ready' },
      OTHER,
    );
  });

  it('ignores messages from another source than the parent', async () => {
    const { send, handler, parent } = await setup();
    send(request(), HOST, {});
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('ignores messages without the pockey tag', async () => {
    const { send, handler, parent } = await setup();
    send({ ...request(), source: 'metamask' });
    send('hello');
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('ignores origins outside the allowlist, even with a valid request', async () => {
    const { send, handler, parent } = await setup();
    send(request(), 'https://evil.example');
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('ignores an invalid shape that carries no request id', async () => {
    const { send, handler, parent } = await setup();
    send({ source: 'pockey', pk: 1, type: 'getUser' });
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('answers invalid_message to a malformed request from an allowed origin', async () => {
    const { send, handler, parent } = await setup();
    send({ source: 'pockey', pk: 1, requestId: 'bad-1', type: 'signMessage', walletId: 42 });
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        source: 'pockey',
        pk: 1,
        type: 'response',
        requestId: 'bad-1',
        ok: false,
        error: { code: 'invalid_message', message: expect.any(String) as unknown },
      },
      HOST,
    );
  });

  it('responds with the handler result, posted to the exact host origin', async () => {
    const { send, handler, parent } = await setup(async () => ({ user: null }));
    send(request());
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[1]).toMatchObject({ origin: HOST });
    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        source: 'pockey',
        pk: 1,
        type: 'response',
        requestId: 'req-1',
        ok: true,
        data: { user: null },
      },
      HOST,
    );
  });

  it('turns a rejection into an error response with its code', async () => {
    const { send, parent } = await setup(async () => {
      throw new EmbedFailure('user_rejected', 'No.');
    });
    send(request({ requestId: 'req-2' }));
    await flush();
    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        source: 'pockey',
        pk: 1,
        type: 'response',
        requestId: 'req-2',
        ok: false,
        error: { code: 'user_rejected', message: 'No.' },
      },
      HOST,
    );
  });

  it('locks to the first accepted origin and ignores the others afterwards', async () => {
    const { send, handler, parent, messenger } = await setup();
    send(request({ requestId: 'a' }), OTHER);
    await flush();
    send(request({ requestId: 'b' }), HOST);
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(messenger.hostOrigin()).toBe(OTHER);
    for (const call of parent.postMessage.mock.calls) expect(call[1]).toBe(OTHER);
  });

  it('posts visibility to the host only when it changes', async () => {
    const { send, parent, messenger } = await setup();
    messenger.setVisible(true);
    expect(parent.postMessage).not.toHaveBeenCalled();
    send(request());
    await flush();
    parent.postMessage.mockClear();
    messenger.setVisible(true);
    messenger.setVisible(true);
    messenger.setVisible(false);
    expect(parent.postMessage.mock.calls).toEqual([
      [{ source: 'pockey', pk: 1, type: 'visibility', visible: true }, HOST],
      [{ source: 'pockey', pk: 1, type: 'visibility', visible: false }, HOST],
    ]);
  });
});
