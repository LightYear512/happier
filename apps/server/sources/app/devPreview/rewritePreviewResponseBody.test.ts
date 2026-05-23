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

  it('adds the current preview token to rewritten initial HTML asset URLs', () => {
    const rewritten = rewritePreviewResponseBody({
      contentType: 'text/html; charset=utf-8',
      body: [
        '<html><head>',
        '<script type="module" src="/@vite/client"></script>',
        '<script type="module" src="/src/main.ts?import=1"></script>',
        '<link rel="stylesheet" href="/src/main.css">',
        '</head></html>',
      ].join(''),
      routeContext,
      previewToken: 'token_1',
      injectRuntimeInterceptor: false,
    });

    expect(rewritten).toContain('/preview/session_1/machine_1/route_1/@vite/client?previewToken=token_1');
    expect(rewritten).toContain('/preview/session_1/machine_1/route_1/src/main.ts?import=1&previewToken=token_1');
    expect(rewritten).toContain('/preview/session_1/machine_1/route_1/src/main.css?previewToken=token_1');
  });

  it('rewrites initial HTML asset URLs to the preview host root for host namespaces', () => {
    const rewritten = rewritePreviewResponseBody({
      contentType: 'text/html; charset=utf-8',
      body: [
        '<html><head>',
        '<script type="module" src="/@vite/client"></script>',
        '<link rel="stylesheet" href="http://127.0.0.1:3000/src/main.css">',
        '<meta http-equiv="refresh" content="0; url=/login">',
        '</head></html>',
      ].join(''),
      routeContext,
      namespaceStrategy: 'host',
      previewToken: 'token_1',
      injectRuntimeInterceptor: false,
    });

    expect(rewritten).toContain('/@vite/client?previewToken=token_1');
    expect(rewritten).toContain('/src/main.css?previewToken=token_1');
    expect(rewritten).toContain('url=/login?previewToken=token_1');
    expect(rewritten).not.toContain('/preview/session_1/machine_1/route_1/');
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

  it('rewrites JavaScript module specifiers for the current preview route', () => {
    const rewritten = rewritePreviewResponseBody({
      contentType: 'application/javascript; charset=utf-8',
      body: [
        'import { createApp } from "/node_modules/.vite/deps/vue.js?v=123";',
        'import App from "/src/App.vue";',
        'import "/src/assets/styles.css";',
        'export { router } from "/src/router/index.ts";',
        'const lazy = () => import("/src/lazy.ts");',
      ].join('\n'),
      routeContext,
      previewToken: 'token_1',
    });

    expect(rewritten).toContain('from "/preview/session_1/machine_1/route_1/node_modules/.vite/deps/vue.js?v=123&previewToken=token_1"');
    expect(rewritten).toContain('from "/preview/session_1/machine_1/route_1/src/App.vue?previewToken=token_1"');
    expect(rewritten).toContain('import "/preview/session_1/machine_1/route_1/src/assets/styles.css?previewToken=token_1"');
    expect(rewritten).toContain('from "/preview/session_1/machine_1/route_1/src/router/index.ts?previewToken=token_1"');
    expect(rewritten).toContain('import("/preview/session_1/machine_1/route_1/src/lazy.ts?previewToken=token_1")');
  });

  it('preserves Vite bare query flags when appending the preview token', () => {
    const rewritten = rewritePreviewResponseBody({
      contentType: 'application/javascript; charset=utf-8',
      body: 'import "/src/App.vue?vue&type=style&index=0&scoped=abc&lang.css";',
      routeContext,
      previewToken: 'token_1',
    });

    expect(rewritten).toContain('/preview/session_1/machine_1/route_1/src/App.vue?vue&type=style&index=0&scoped=abc&lang.css&previewToken=token_1');
    expect(rewritten).not.toContain('vue=');
    expect(rewritten).not.toContain('lang.css=');
  });

  it('does not rewrite import-looking strings inside JavaScript modules', () => {
    const rewritten = rewritePreviewResponseBody({
      contentType: 'application/javascript; charset=utf-8',
      body: [
        'const css = `@import "/src/assets/theme.css"; .button { color: red; }`;',
        'import App from "/src/App.vue";',
      ].join('\n'),
      routeContext,
      previewToken: 'token_1',
    });

    expect(rewritten).toContain('@import "/src/assets/theme.css"');
    expect(rewritten).toContain('from "/preview/session_1/machine_1/route_1/src/App.vue?previewToken=token_1"');
  });
});
