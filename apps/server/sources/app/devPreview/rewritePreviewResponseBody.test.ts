import { describe, expect, it } from 'vitest';

import { rewritePreviewResponseBody } from './rewritePreviewResponseBody';

const routeContext = {
  sessionId: 'session_1',
  machineId: 'machine_1',
  routeKey: 'route_1',
};

describe('rewritePreviewResponseBody', () => {
  it('rewrites common HTML asset URLs and injects the runtime interceptor', () => {
    const rewritten = rewritePreviewResponseBody({
      contentType: 'text/html; charset=utf-8',
      body: [
        '<html><head>',
        '<script src="/@vite/client"></script>',
        '<link rel="stylesheet" href="http://127.0.0.1:3000/src/main.css">',
        '<meta http-equiv="refresh" content="0; url=/login">',
        '</head><body>',
        '<img srcset="/assets/a.png 1x, http://localhost:3000/assets/b.png 2x">',
        '</body></html>',
      ].join(''),
      routeContext,
    });

    expect(rewritten).toContain('/preview/session_1/machine_1/route_1/@vite/client');
    expect(rewritten).toContain('/preview/session_1/machine_1/route_1/src/main.css');
    expect(rewritten).toContain('/preview/session_1/machine_1/route_1/assets/a.png 1x');
    expect(rewritten).toContain('/preview/session_1/machine_1/route_1/assets/b.png 2x');
    expect(rewritten).toContain('/preview/session_1/machine_1/route_1/login');
    expect(rewritten).toContain('__happierDevPreviewPatched__');
    expect(rewritten).toContain('XMLHttpRequest.prototype.open');
    expect(rewritten).toContain('window.EventSource');
    expect(rewritten).toContain('window.WebSocket');
  });

  it('leaves protocol-relative external HTML asset URLs unchanged', () => {
    const rewritten = rewritePreviewResponseBody({
      contentType: 'text/html; charset=utf-8',
      body: '<html><head><script src="//cdn.example.test/app.js"></script></head></html>',
      routeContext,
      injectRuntimeInterceptor: false,
    });

    expect(rewritten).toBe('<html><head><script src="//cdn.example.test/app.js"></script></head></html>');
  });

  it('rewrites CSS url() and @import references for the current preview route', () => {
    const rewritten = rewritePreviewResponseBody({
      contentType: 'text/css',
      body: [
        '@import "/styles/theme.css";',
        '@import url("http://127.0.0.1:3000/styles/print.css");',
        'body { background-image: url(/assets/bg.png); }',
      ].join('\n'),
      routeContext,
    });

    expect(rewritten).toContain('@import "/preview/session_1/machine_1/route_1/styles/theme.css";');
    expect(rewritten).toContain('@import url("/preview/session_1/machine_1/route_1/styles/print.css");');
    expect(rewritten).toContain('url(/preview/session_1/machine_1/route_1/assets/bg.png)');
  });
});
