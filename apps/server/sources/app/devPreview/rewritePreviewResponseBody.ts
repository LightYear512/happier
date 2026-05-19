import { createPreviewRuntimeInterceptorSource } from './createPreviewRuntimeInterceptorSource';
import {
  type PreviewRouteContext,
  rewritePreviewSrcSetValue,
  rewritePreviewUrlValue,
} from './previewRoutePaths';

type RewritePreviewResponseBodyParams = Readonly<{
  contentType: string;
  body: string;
  routeContext: PreviewRouteContext;
  runtimeScriptNonce?: string | null;
  injectRuntimeInterceptor?: boolean;
}>;

const REWRITABLE_ATTRIBUTE_NAMES = [
  'src',
  'href',
  'action',
  'formaction',
  'poster',
  'manifest',
  'data',
  'cite',
  'longdesc',
] as const;

const REWRITABLE_CONTENT_TYPES = {
  html: ['text/html', 'application/xhtml+xml'],
  css: ['text/css'],
} as const;

function shouldRewriteAsHtml(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return REWRITABLE_CONTENT_TYPES.html.some((candidate) => normalized.includes(candidate));
}

function shouldRewriteAsCss(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return REWRITABLE_CONTENT_TYPES.css.some((candidate) => normalized.includes(candidate));
}

function rewriteCssText(body: string, routeContext: PreviewRouteContext): string {
  let rewritten = body.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, quote: string, rawUrl: string) => {
    const nextUrl = rewritePreviewUrlValue(rawUrl, routeContext);
    if (!nextUrl) {
      return full;
    }
    return `url(${quote}${nextUrl}${quote})`;
  });

  rewritten = rewritten.replace(/@import\s+(url\(\s*)?(['"])([^'"]+)\2(\s*\))?/gi, (full, urlPrefix: string | undefined, quote: string, rawUrl: string, urlSuffix: string | undefined) => {
    const nextUrl = rewritePreviewUrlValue(rawUrl, routeContext);
    if (!nextUrl) {
      return full;
    }
    if (urlPrefix) {
      return `@import ${urlPrefix}${quote}${nextUrl}${quote}${urlSuffix ?? ''}`;
    }
    return `@import ${quote}${nextUrl}${quote}`;
  });

  return rewritten;
}

function rewriteHtmlAttributes(body: string, routeContext: PreviewRouteContext): string {
  let rewritten = body;

  for (const attributeName of REWRITABLE_ATTRIBUTE_NAMES) {
    const pattern = new RegExp(`\\b${attributeName}\\s*=\\s*(['"])(.*?)\\1`, 'gi');
    rewritten = rewritten.replace(pattern, (full, quote: string, rawValue: string) => {
      const nextValue = rewritePreviewUrlValue(rawValue, routeContext);
      return nextValue ? `${attributeName}=${quote}${nextValue}${quote}` : full;
    });
  }

  rewritten = rewritten.replace(/\bsrcset\s*=\s*(['"])(.*?)\1/gi, (_full, quote: string, rawValue: string) => {
    const nextValue = rewritePreviewSrcSetValue(rawValue, routeContext);
    return `srcset=${quote}${nextValue}${quote}`;
  });

  rewritten = rewritten.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, cssBody: string) => {
    const nextCssBody = rewriteCssText(cssBody, routeContext);
    return nextCssBody === cssBody ? full : full.replace(cssBody, nextCssBody);
  });

  rewritten = rewritten.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (!/\bhttp-equiv\s*=\s*(['"])refresh\1/i.test(tag)) {
      return tag;
    }
    return tag.replace(/\bcontent\s*=\s*(['"])(.*?)\1/i, (full, quote: string, rawContent: string) => {
      const match = rawContent.match(/^([^;]+;\s*url=)(.+)$/i);
      if (!match) {
        return full;
      }
      const nextUrl = rewritePreviewUrlValue(match[2].trim(), routeContext);
      if (!nextUrl) {
        return full;
      }
      return `content=${quote}${match[1]}${nextUrl}${quote}`;
    });
  });

  return rewritten;
}

function injectRuntimeInterceptor(
  body: string,
  routeContext: PreviewRouteContext,
  runtimeScriptNonce?: string | null,
): string {
  if (body.includes('__happierDevPreviewPatched__')) {
    return body;
  }

  const nonceAttribute = runtimeScriptNonce ? ` nonce="${runtimeScriptNonce}"` : '';
  const scriptTag = `<script${nonceAttribute}>${createPreviewRuntimeInterceptorSource(routeContext)}</script>`;

  if (/<head\b[^>]*>/i.test(body)) {
    return body.replace(/<head\b[^>]*>/i, (match) => `${match}${scriptTag}`);
  }
  if (/<html\b[^>]*>/i.test(body)) {
    return body.replace(/<html\b[^>]*>/i, (match) => `${match}${scriptTag}`);
  }
  return `${scriptTag}${body}`;
}

export function rewritePreviewResponseBody(params: RewritePreviewResponseBodyParams): string {
  if (shouldRewriteAsCss(params.contentType)) {
    return rewriteCssText(params.body, params.routeContext);
  }

  if (!shouldRewriteAsHtml(params.contentType)) {
    return params.body;
  }

  const rewrittenHtml = rewriteHtmlAttributes(params.body, params.routeContext);
  return params.injectRuntimeInterceptor === false
    ? rewrittenHtml
    : injectRuntimeInterceptor(rewrittenHtml, params.routeContext, params.runtimeScriptNonce);
}
