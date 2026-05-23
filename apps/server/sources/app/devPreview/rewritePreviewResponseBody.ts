import { createPreviewRuntimeInterceptorSource } from './createPreviewRuntimeInterceptorSource';
import {
  type PreviewRouteContext,
  type PreviewNamespaceStrategy,
  rewritePreviewSrcSetValue,
  rewritePreviewUrlValue,
} from './previewRoutePaths';

type RewritePreviewResponseBodyParams = Readonly<{
  contentType: string;
  body: string;
  routeContext: PreviewRouteContext;
  previewToken?: string | null;
  namespaceStrategy?: PreviewNamespaceStrategy;
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
  javascript: ['application/javascript', 'text/javascript', 'application/ecmascript', 'text/ecmascript', 'application/x-javascript'],
} as const;

function shouldRewriteAsHtml(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return REWRITABLE_CONTENT_TYPES.html.some((candidate) => normalized.includes(candidate));
}

function shouldRewriteAsCss(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return REWRITABLE_CONTENT_TYPES.css.some((candidate) => normalized.includes(candidate));
}

function shouldRewriteAsJavaScript(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return REWRITABLE_CONTENT_TYPES.javascript.some((candidate) => normalized.includes(candidate));
}

function rewriteCssText(
  body: string,
  routeContext: PreviewRouteContext,
  previewToken?: string | null,
  namespaceStrategy: PreviewNamespaceStrategy = 'path',
): string {
  let rewritten = body.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, quote: string, rawUrl: string) => {
    const nextUrl = rewritePreviewUrlValue(rawUrl, routeContext, previewToken, namespaceStrategy);
    if (!nextUrl) {
      return full;
    }
    return `url(${quote}${nextUrl}${quote})`;
  });

  rewritten = rewritten.replace(/@import\s+(url\(\s*)?(['"])([^'"]+)\2(\s*\))?/gi, (full, urlPrefix: string | undefined, quote: string, rawUrl: string, urlSuffix: string | undefined) => {
    const nextUrl = rewritePreviewUrlValue(rawUrl, routeContext, previewToken, namespaceStrategy);
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

function rewriteJavaScriptText(
  body: string,
  routeContext: PreviewRouteContext,
  previewToken?: string | null,
  namespaceStrategy: PreviewNamespaceStrategy = 'path',
): string {
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const length = body.length;

  const isIdentifierPart = (char: string | undefined): boolean => typeof char === 'string' && /[A-Za-z0-9_$]/.test(char);
  const startsKeywordAt = (index: number, keyword: string): boolean =>
    body.startsWith(keyword, index)
    && !isIdentifierPart(body[index - 1])
    && !isIdentifierPart(body[index + keyword.length])
    && body[index + keyword.length] !== '.';
  const skipWhitespace = (index: number): number => {
    let cursor = index;
    while (cursor < length && /\s/.test(body[cursor]!)) cursor += 1;
    return cursor;
  };
  const skipQuotedString = (index: number): number => {
    const quote = body[index];
    let cursor = index + 1;
    while (cursor < length) {
      const char = body[cursor];
      if (char === '\\') {
        cursor += 2;
        continue;
      }
      cursor += 1;
      if (char === quote) break;
    }
    return cursor;
  };
  const skipLineComment = (index: number): number => {
    const next = body.indexOf('\n', index + 2);
    return next === -1 ? length : next + 1;
  };
  const skipBlockComment = (index: number): number => {
    const next = body.indexOf('*/', index + 2);
    return next === -1 ? length : next + 2;
  };
  const readStringLiteral = (quoteIndex: number): { end: number; raw: string } | null => {
    const quote = body[quoteIndex];
    let cursor = quoteIndex + 1;
    let raw = '';
    while (cursor < length) {
      const char = body[cursor];
      if (char === '\\') {
        raw += body.slice(cursor, Math.min(cursor + 2, length));
        cursor += 2;
        continue;
      }
      if (char === quote) {
        return { end: cursor + 1, raw };
      }
      raw += char;
      cursor += 1;
    }
    return null;
  };
  const addSpecifierEdit = (quoteIndex: number): number => {
    const literal = readStringLiteral(quoteIndex);
    if (!literal) return quoteIndex + 1;
    const nextUrl = rewritePreviewUrlValue(literal.raw, routeContext, previewToken, namespaceStrategy);
    if (nextUrl) {
      edits.push({ start: quoteIndex + 1, end: literal.end - 1, value: nextUrl });
    }
    return literal.end;
  };
  const findFromSpecifier = (index: number): number => {
    let cursor = index;
    while (cursor < length) {
      const char = body[cursor];
      if (char === '"' || char === '\'' || char === '`') {
        cursor = skipQuotedString(cursor);
        continue;
      }
      if (char === '/' && body[cursor + 1] === '/') {
        cursor = skipLineComment(cursor);
        continue;
      }
      if (char === '/' && body[cursor + 1] === '*') {
        cursor = skipBlockComment(cursor);
        continue;
      }
      if (char === ';' || char === '\n') return cursor;
      if (startsKeywordAt(cursor, 'from')) {
        const quoteIndex = skipWhitespace(cursor + 'from'.length);
        if (body[quoteIndex] === '"' || body[quoteIndex] === '\'') {
          return addSpecifierEdit(quoteIndex);
        }
      }
      cursor += 1;
    }
    return cursor;
  };

  let cursor = 0;
  while (cursor < length) {
    const char = body[cursor];
    if (char === '"' || char === '\'' || char === '`') {
      cursor = skipQuotedString(cursor);
      continue;
    }
    if (char === '/' && body[cursor + 1] === '/') {
      cursor = skipLineComment(cursor);
      continue;
    }
    if (char === '/' && body[cursor + 1] === '*') {
      cursor = skipBlockComment(cursor);
      continue;
    }
    if (startsKeywordAt(cursor, 'import')) {
      const next = skipWhitespace(cursor + 'import'.length);
      if (body[next] === '"' || body[next] === '\'') {
        cursor = addSpecifierEdit(next);
        continue;
      }
      if (body[next] === '(') {
        const quoteIndex = skipWhitespace(next + 1);
        if (body[quoteIndex] === '"' || body[quoteIndex] === '\'') {
          cursor = addSpecifierEdit(quoteIndex);
          continue;
        }
      }
      cursor = findFromSpecifier(next);
      continue;
    }
    if (startsKeywordAt(cursor, 'export')) {
      cursor = findFromSpecifier(cursor + 'export'.length);
      continue;
    }
    cursor += 1;
  }

  if (edits.length === 0) return body;
  let rewritten = '';
  let lastIndex = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    rewritten += body.slice(lastIndex, edit.start);
    rewritten += edit.value;
    lastIndex = edit.end;
  }
  return rewritten + body.slice(lastIndex);
}

function rewriteHtmlAttributes(
  body: string,
  routeContext: PreviewRouteContext,
  previewToken?: string | null,
  namespaceStrategy: PreviewNamespaceStrategy = 'path',
): string {
  let rewritten = body;

  for (const attributeName of REWRITABLE_ATTRIBUTE_NAMES) {
    const pattern = new RegExp(`\\b${attributeName}\\s*=\\s*(['"])(.*?)\\1`, 'gi');
    rewritten = rewritten.replace(pattern, (full, quote: string, rawValue: string) => {
      const nextValue = rewritePreviewUrlValue(rawValue, routeContext, previewToken, namespaceStrategy);
      return nextValue ? `${attributeName}=${quote}${nextValue}${quote}` : full;
    });
  }

  rewritten = rewritten.replace(/\bsrcset\s*=\s*(['"])(.*?)\1/gi, (_full, quote: string, rawValue: string) => {
    const nextValue = rewritePreviewSrcSetValue(rawValue, routeContext, previewToken, namespaceStrategy);
    return `srcset=${quote}${nextValue}${quote}`;
  });

  rewritten = rewritten.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, cssBody: string) => {
    const nextCssBody = rewriteCssText(cssBody, routeContext, previewToken, namespaceStrategy);
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
      const nextUrl = rewritePreviewUrlValue(match[2].trim(), routeContext, previewToken, namespaceStrategy);
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
  namespaceStrategy: PreviewNamespaceStrategy,
  runtimeScriptNonce?: string | null,
): string {
  if (body.includes('__happierDevPreviewPatched__')) {
    return body;
  }

  const nonceAttribute = runtimeScriptNonce ? ` nonce="${runtimeScriptNonce}"` : '';
  const scriptTag = `<script${nonceAttribute}>${createPreviewRuntimeInterceptorSource(routeContext, namespaceStrategy)}</script>`;

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
    return rewriteCssText(params.body, params.routeContext, params.previewToken, params.namespaceStrategy);
  }

  if (shouldRewriteAsJavaScript(params.contentType)) {
    return rewriteJavaScriptText(params.body, params.routeContext, params.previewToken, params.namespaceStrategy);
  }

  if (!shouldRewriteAsHtml(params.contentType)) {
    return params.body;
  }

  const namespaceStrategy = params.namespaceStrategy ?? 'path';
  const rewrittenHtml = rewriteHtmlAttributes(params.body, params.routeContext, params.previewToken, namespaceStrategy);
  return params.injectRuntimeInterceptor === false
    ? rewrittenHtml
    : injectRuntimeInterceptor(rewrittenHtml, params.routeContext, namespaceStrategy, params.runtimeScriptNonce);
}
