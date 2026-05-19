import type { PreviewRouteContext } from './previewRoutePaths';
import { buildPreviewRouteBasePath } from './previewRoutePaths';

export function createPreviewRuntimeInterceptorSource(context: PreviewRouteContext): string {
  const basePath = JSON.stringify(buildPreviewRouteBasePath(context));

  return `(() => {
  if (typeof window === 'undefined' || window.__happierDevPreviewPatched__) {
    return;
  }
  window.__happierDevPreviewPatched__ = true;
  const previewBasePath = ${basePath};
  const currentPreviewToken = (() => {
    try {
      const token = new URL(window.location.href).searchParams.get('previewToken');
      return token && String(token).trim() ? String(token).trim() : null;
    } catch {
      return null;
    }
  })();
  if (currentPreviewToken && window.history && typeof window.history.replaceState === 'function') {
    try {
      const parsed = new URL(window.location.href);
      parsed.searchParams.delete('previewToken');
      window.history.replaceState(window.history.state ?? null, '', \`\${parsed.pathname}\${parsed.search}\${parsed.hash}\`);
    } catch {
    }
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0:0:0:0:0:0:0:1']);
  const normalizeHostname = (hostname) => {
    const lowered = String(hostname || '').trim().toLowerCase();
    return lowered.startsWith('[') && lowered.endsWith(']') ? lowered.slice(1, -1) : lowered;
  };
  const shouldIgnore = (value) =>
    !value
    || value.startsWith('#')
    || /^(?:data|blob|file|javascript|mailto|tel|about):/i.test(value);
  const appendPreviewToken = (value) => {
    if (!currentPreviewToken) {
      return value;
    }
    try {
      const parsed = new URL(value, window.location.origin);
      if (!parsed.pathname.startsWith(previewBasePath) || parsed.searchParams.has('previewToken')) {
        return value;
      }
      parsed.searchParams.set('previewToken', currentPreviewToken);
      return \`\${parsed.pathname}\${parsed.search}\${parsed.hash}\`;
    } catch {
      return value;
    }
  };
  const buildRelayPath = (input) => {
    const path = input.pathname.startsWith('/') ? input.pathname.slice(1) : input.pathname;
    return appendPreviewToken(\`\${previewBasePath}\${path}\${input.search}\${input.hash}\`);
  };
  const rewriteUrl = (value, kind) => {
    const raw = value instanceof URL ? value.toString() : String(value || '');
    if (shouldIgnore(raw)) {
      return raw;
    }
    if (raw.startsWith(previewBasePath)) {
      return appendPreviewToken(raw);
    }

    let parsed = null;
    if (raw.startsWith('//')) {
      parsed = new URL(raw, window.location.href);
      const protocol = String(parsed.protocol || '').toLowerCase();
      const isLoopback =
        ['http:', 'https:', 'ws:', 'wss:'].includes(protocol)
        && loopbackHosts.has(normalizeHostname(parsed.hostname));
      if (!isLoopback) {
        return raw;
      }
    } else if (raw.startsWith('/')) {
      parsed = new URL(raw, window.location.href);
    } else {
      try {
        parsed = new URL(raw, window.location.href);
      } catch {
        return raw;
      }
      const protocol = String(parsed.protocol || '').toLowerCase();
      const isLoopback =
        ['http:', 'https:', 'ws:', 'wss:'].includes(protocol)
        && loopbackHosts.has(normalizeHostname(parsed.hostname));
      const isSameOriginRoot =
        parsed.origin === window.location.origin && parsed.pathname.startsWith('/') && !parsed.pathname.startsWith(previewBasePath);
      if (!isLoopback && !isSameOriginRoot) {
        return raw;
      }
    }

    const relayPath = buildRelayPath(parsed);
    if (kind === 'ws') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return \`\${protocol}//\${window.location.host}\${relayPath}\`;
    }
    return relayPath;
  };

  if (typeof window.fetch === 'function') {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function patchedFetch(input, init) {
      if (typeof Request !== 'undefined' && input instanceof Request) {
        const rewritten = rewriteUrl(input.url, 'http');
        if (rewritten !== input.url) {
          return nativeFetch(new Request(rewritten, input), init);
        }
        return nativeFetch(input, init);
      }
      if (input instanceof URL) {
        return nativeFetch(rewriteUrl(input.toString(), 'http'), init);
      }
      if (typeof input === 'string') {
        return nativeFetch(rewriteUrl(input, 'http'), init);
      }
      return nativeFetch(input, init);
    };
  }

  if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype && typeof XMLHttpRequest.prototype.open === 'function') {
    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
      return nativeOpen.call(this, method, rewriteUrl(String(url || ''), 'http'), ...rest);
    };
  }

  if (typeof window.EventSource === 'function') {
    const NativeEventSource = window.EventSource;
    const PatchedEventSource = function(url, config) {
      return new NativeEventSource(rewriteUrl(String(url || ''), 'http'), config);
    };
    PatchedEventSource.prototype = NativeEventSource.prototype;
    Object.setPrototypeOf(PatchedEventSource, NativeEventSource);
    window.EventSource = PatchedEventSource;
  }

  if (typeof window.WebSocket === 'function') {
    const NativeWebSocket = window.WebSocket;
    const PatchedWebSocket = function(url, protocols) {
      return new NativeWebSocket(rewriteUrl(String(url || ''), 'ws'), protocols);
    };
    PatchedWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(PatchedWebSocket, NativeWebSocket);
    window.WebSocket = PatchedWebSocket;
  }
})();`;
}
