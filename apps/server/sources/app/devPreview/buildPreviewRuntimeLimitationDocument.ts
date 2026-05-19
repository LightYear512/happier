const PREVIEW_LIMITATION_DOCUMENT_STYLE = [
  ':root { color-scheme: dark light; }',
  'body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }',
  'main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }',
  'section { width: min(640px, 100%); border: 1px solid rgba(148, 163, 184, 0.3); border-radius: 8px; padding: 20px; background: rgba(15, 23, 42, 0.92); }',
  'h1 { margin: 0 0 12px; font-size: 18px; font-weight: 600; }',
  'p { margin: 0 0 12px; line-height: 1.5; }',
  'code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }',
].join('');

export const PREVIEW_LIMITATION_DOCUMENT_CSP = "default-src 'none'; style-src 'unsafe-inline'";

function describeReason(reason: 'script-src-none' | 'script-src-strict-dynamic'): string {
  if (reason === 'script-src-none') {
    return 'The upstream content-security-policy forbids all scripts, so Happier cannot inject the preview URL rewriter.';
  }
  return 'The upstream content-security-policy uses a strict-dynamic script policy that Happier cannot widen safely for the preview rewriter.';
}

export function buildPreviewRuntimeLimitationDocument(params: Readonly<{
  reason: 'script-src-none' | 'script-src-strict-dynamic';
}>): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>${PREVIEW_LIMITATION_DOCUMENT_STYLE}</style>`,
    '</head>',
    '<body>',
    '<main>',
    '<section>',
    '<h1>Preview limitation</h1>',
    `<p>${describeReason(params.reason)}</p>`,
    '<p>This preview stays isolated because <code>content-security-policy</code> prevented the runtime bridge from loading.</p>',
    '</section>',
    '</main>',
    '</body>',
    '</html>',
  ].join('');
}
