import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import { createPreviewRuntimeInterceptorSource } from './createPreviewRuntimeInterceptorSource';

const routeContext = {
  sessionId: 'session_1',
  machineId: 'machine_1',
  routeKey: 'route_1',
};

class FakeRequest {
  url: string;

  constructor(input: string, _init?: unknown) {
    this.url = String(input);
  }
}

describe('createPreviewRuntimeInterceptorSource', () => {
  it('rewrites root-relative runtime URLs for fetch, XHR, EventSource, and WebSocket', async () => {
    const fetchCalls: unknown[] = [];
    const xhrOpen = vi.fn();
    const eventSourceCalls: Array<{ url: string; config: unknown }> = [];
    const webSocketCalls: Array<{ url: string; protocols: unknown }> = [];

    class FakeXmlHttpRequest {
      open(method: string, url: string, async?: boolean) {
        return xhrOpen(method, url, async);
      }
    }

    class FakeEventSource {
      constructor(url: string, config?: unknown) {
        eventSourceCalls.push({ url, config });
      }
    }

    class FakeWebSocket {
      constructor(url: string, protocols?: unknown) {
        webSocketCalls.push({ url, protocols });
      }
    }

    const windowTarget = {
      location: new URL('https://app.happier.dev/preview/session_1/machine_1/route_1/index.html'),
      fetch: vi.fn(async (input: unknown) => {
        fetchCalls.push(input);
        return { ok: true };
      }),
      EventSource: FakeEventSource,
      WebSocket: FakeWebSocket,
    };

    vm.runInNewContext(createPreviewRuntimeInterceptorSource(routeContext), {
      window: windowTarget,
      XMLHttpRequest: FakeXmlHttpRequest,
      Request: FakeRequest,
      URL,
      Object,
      Set,
      String,
      Array,
      Buffer,
    });

    await windowTarget.fetch('/api/messages');
    const xhr = new FakeXmlHttpRequest();
    xhr.open('GET', '/events', true);
    new windowTarget.EventSource('/stream', { withCredentials: false });
    new windowTarget.WebSocket('/hmr', ['vite-hmr']);

    expect(fetchCalls).toEqual(['/preview/session_1/machine_1/route_1/api/messages']);
    expect(xhrOpen).toHaveBeenCalledWith('GET', '/preview/session_1/machine_1/route_1/events', true);
    expect(eventSourceCalls).toEqual([
      {
        url: '/preview/session_1/machine_1/route_1/stream',
        config: { withCredentials: false },
      },
    ]);
    expect(webSocketCalls).toEqual([
      {
        url: 'wss://app.happier.dev/preview/session_1/machine_1/route_1/hmr',
        protocols: ['vite-hmr'],
      },
    ]);
  });

  it('leaves external and already-rewritten URLs unchanged', async () => {
    const fetchCalls: unknown[] = [];

    const windowTarget = {
      location: new URL('https://app.happier.dev/preview/session_1/machine_1/route_1/index.html'),
      fetch: vi.fn(async (input: unknown) => {
        fetchCalls.push(input);
        return { ok: true };
      }),
    };

    vm.runInNewContext(createPreviewRuntimeInterceptorSource(routeContext), {
      window: windowTarget,
      Request: FakeRequest,
      URL,
      Object,
      Set,
      String,
      Array,
      Buffer,
    });

    await windowTarget.fetch('https://example.test/logo.svg');
    await windowTarget.fetch('//cdn.example.test/runtime.js');
    await windowTarget.fetch('/preview/session_1/machine_1/route_1/@vite/client');

    expect(fetchCalls).toEqual([
      'https://example.test/logo.svg',
      '//cdn.example.test/runtime.js',
      '/preview/session_1/machine_1/route_1/@vite/client',
    ]);
  });

  it('does not double-prefix relative URLs resolved from nested preview paths', async () => {
    const fetchCalls: unknown[] = [];
    const webSocketCalls: Array<{ url: string; protocols: unknown }> = [];

    class FakeWebSocket {
      constructor(url: string, protocols?: unknown) {
        webSocketCalls.push({ url, protocols });
      }
    }

    const windowTarget = {
      location: new URL('https://app.happier.dev/preview/session_1/machine_1/route_1/ai-console/develop/?previewToken=token_1'),
      fetch: vi.fn(async (input: unknown) => {
        fetchCalls.push(input);
        return { ok: true };
      }),
      history: {
        state: null,
        replaceState: vi.fn(),
      },
      WebSocket: FakeWebSocket,
    };

    vm.runInNewContext(createPreviewRuntimeInterceptorSource(routeContext), {
      window: windowTarget,
      Request: FakeRequest,
      URL,
      Object,
      Set,
      String,
      Array,
      Buffer,
    });

    await windowTarget.fetch('api/state');
    new windowTarget.WebSocket('wss://app.happier.dev/preview/session_1/machine_1/route_1/ai-console/develop/hmr', ['vite-hmr']);

    expect(fetchCalls).toEqual([
      '/preview/session_1/machine_1/route_1/ai-console/develop/api/state?previewToken=token_1',
    ]);
    expect(webSocketCalls).toEqual([
      {
        url: 'wss://app.happier.dev/preview/session_1/machine_1/route_1/ai-console/develop/hmr?previewToken=token_1',
        protocols: ['vite-hmr'],
      },
    ]);
  });

  it('carries the current preview token onto runtime-rewritten relay requests', async () => {
    const fetchCalls: unknown[] = [];
    const webSocketCalls: Array<{ url: string; protocols: unknown }> = [];
    const replaceState = vi.fn();

    class FakeWebSocket {
      constructor(url: string, protocols?: unknown) {
        webSocketCalls.push({ url, protocols });
      }
    }

    const windowTarget = {
      location: new URL('https://app.happier.dev/preview/session_1/machine_1/route_1/index.html?previewToken=token_1'),
      fetch: vi.fn(async (input: unknown) => {
        fetchCalls.push(input);
        return { ok: true };
      }),
      history: {
        state: { preview: true },
        replaceState,
      },
      WebSocket: FakeWebSocket,
    };

    vm.runInNewContext(createPreviewRuntimeInterceptorSource(routeContext), {
      window: windowTarget,
      Request: FakeRequest,
      URL,
      Object,
      Set,
      String,
      Array,
      Buffer,
    });

    await windowTarget.fetch('/api/messages?cursor=1');
    await windowTarget.fetch('/preview/session_1/machine_1/route_1/@vite/client');
    new windowTarget.WebSocket('/hmr', ['vite-hmr']);

    expect(fetchCalls).toEqual([
      '/preview/session_1/machine_1/route_1/api/messages?cursor=1&previewToken=token_1',
      '/preview/session_1/machine_1/route_1/@vite/client?previewToken=token_1',
    ]);
    expect(webSocketCalls).toEqual([
      {
        url: 'wss://app.happier.dev/preview/session_1/machine_1/route_1/hmr?previewToken=token_1',
        protocols: ['vite-hmr'],
      },
    ]);
    expect(replaceState).toHaveBeenCalledWith(
      { preview: true },
      '',
      '/preview/session_1/machine_1/route_1/index.html',
    );
  });
});
