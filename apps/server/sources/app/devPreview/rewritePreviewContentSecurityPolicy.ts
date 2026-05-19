export type PreviewContentSecurityPolicyRewriteResult =
  | Readonly<{
      mode: 'inject';
      headerValues: string[];
    }>
  | Readonly<{
      mode: 'blocked';
      reason: 'script-src-none' | 'script-src-strict-dynamic';
    }>;

type ContentSecurityPolicyDirective = {
  name: string;
  values: string[];
};

const SCRIPT_NONE_TOKEN = "'none'";
const STRICT_DYNAMIC_TOKEN = "'strict-dynamic'";

function parseDirective(rawDirective: string): ContentSecurityPolicyDirective | null {
  const trimmed = rawDirective.trim();
  if (!trimmed) {
    return null;
  }
  const [rawName, ...rawValues] = trimmed.split(/\s+/);
  const name = rawName.trim().toLowerCase();
  if (!name) {
    return null;
  }
  return {
    name,
    values: rawValues.map((value) => value.trim()).filter(Boolean),
  };
}

function serializeDirective(directive: ContentSecurityPolicyDirective): string {
  return directive.values.length > 0
    ? `${directive.name} ${directive.values.join(' ')}`
    : directive.name;
}

function readDirectiveIndex(
  directives: readonly ContentSecurityPolicyDirective[],
  name: string,
): number {
  return directives.findIndex((directive) => directive.name === name);
}

function appendNonceToken(values: readonly string[], nonce: string): string[] {
  const nonceToken = `'nonce-${nonce}'`;
  return values.includes(nonceToken)
    ? [...values]
    : [...values, nonceToken];
}

function rewriteSinglePolicy(headerValue: string, nonce: string): PreviewContentSecurityPolicyRewriteResult {
  const directives = headerValue
    .split(';')
    .map(parseDirective)
    .filter((directive): directive is ContentSecurityPolicyDirective => directive !== null);

  if (directives.length === 0) {
    return {
      mode: 'inject',
      headerValues: [headerValue],
    };
  }

  const scriptSrcIndex = readDirectiveIndex(directives, 'script-src');
  const defaultSrcIndex = readDirectiveIndex(directives, 'default-src');
  const effectiveScriptValues =
    scriptSrcIndex >= 0
      ? directives[scriptSrcIndex]!.values
      : defaultSrcIndex >= 0
        ? directives[defaultSrcIndex]!.values
        : null;

  if (effectiveScriptValues?.includes(SCRIPT_NONE_TOKEN)) {
    return {
      mode: 'blocked',
      reason: 'script-src-none',
    };
  }

  if (effectiveScriptValues?.includes(STRICT_DYNAMIC_TOKEN)) {
    return {
      mode: 'blocked',
      reason: 'script-src-strict-dynamic',
    };
  }

  if (scriptSrcIndex >= 0) {
    directives[scriptSrcIndex] = {
      ...directives[scriptSrcIndex]!,
      values: appendNonceToken(directives[scriptSrcIndex]!.values, nonce),
    };
  } else if (defaultSrcIndex >= 0) {
    directives.push({
      name: 'script-src',
      values: appendNonceToken(directives[defaultSrcIndex]!.values, nonce),
    });
  } else {
    directives.push({
      name: 'script-src',
      values: [`'nonce-${nonce}'`],
    });
  }

  return {
    mode: 'inject',
    headerValues: [directives.map(serializeDirective).join('; ')],
  };
}

export function rewritePreviewContentSecurityPolicy(params: Readonly<{
  headerValues: readonly string[];
  nonce: string;
}>): PreviewContentSecurityPolicyRewriteResult {
  if (params.headerValues.length === 0) {
    return {
      mode: 'inject',
      headerValues: [],
    };
  }

  const rewrittenHeaderValues: string[] = [];
  for (const headerValue of params.headerValues) {
    const rewritten = rewriteSinglePolicy(headerValue, params.nonce);
    if (rewritten.mode === 'blocked') {
      return rewritten;
    }
    rewrittenHeaderValues.push(...rewritten.headerValues);
  }

  return {
    mode: 'inject',
    headerValues: rewrittenHeaderValues,
  };
}
