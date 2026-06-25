import { parseBooleanEnv } from '@/config/env';
import {
    resolveConfiguredCanonicalServerUrl,
    resolveDerivedLocalUiWebappUrl,
    resolveEffectiveWebappBaseUrl,
    resolveExplicitWebappUrl,
} from '@/app/serverUrls/effectiveServerUrls';

import {
    computePreviewSite,
    isHostWildcardableForPreview,
    isSamePreviewSite,
} from './previewSite';

export type HostPreviewBaseDomainSource = 'explicit' | 'derived';
export type EffectiveWebUrlSource = 'explicit' | 'derived_local_ui' | 'default';

export type HostPreviewDisabledReason =
    | 'relay_disabled'
    | 'path_mode_only'
    | 'default_web_url_not_derivable'
    | 'invalid_web_url'
    | 'web_host_not_wildcardable'
    | 'invalid_preview_base_domain'
    | 'cross_site_preview_base_domain';

export type HostPreviewBaseDomainResolution =
    | {
        enabled: true;
        baseDomain: string;
        source: HostPreviewBaseDomainSource;
        effectiveWebUrl: string;
        effectiveWebUrlSource: EffectiveWebUrlSource;
        webSite: string;
        previewSite: string;
    }
    | {
        enabled: false;
        source: 'none' | HostPreviewBaseDomainSource;
        effectiveWebUrl: string;
        effectiveWebUrlSource: EffectiveWebUrlSource;
        reason: HostPreviewDisabledReason;
        fatal: boolean;
    };

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizeBaseDomain(raw: string | undefined): string | null {
    const normalized = String(raw ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
    if (!normalized || normalized.length > 253 || /[:/\\\s]/.test(normalized)) {
        return null;
    }
    return normalized.split('.').every((label) => DNS_LABEL_PATTERN.test(label)) ? normalized : null;
}

function resolveWebUrl(env: NodeJS.ProcessEnv): Readonly<{
    url: string;
    source: EffectiveWebUrlSource;
}> {
    const explicitWebappUrl = resolveExplicitWebappUrl(env);
    if (explicitWebappUrl) {
        return { url: explicitWebappUrl, source: 'explicit' };
    }
    const derivedLocalUiWebappUrl = resolveDerivedLocalUiWebappUrl(env);
    if (derivedLocalUiWebappUrl) {
        return { url: derivedLocalUiWebappUrl, source: 'derived_local_ui' };
    }
    const explicitPublicServerUrl = resolveConfiguredCanonicalServerUrl(env);
    if (explicitPublicServerUrl) {
        return { url: explicitPublicServerUrl, source: 'explicit' };
    }
    return { url: resolveEffectiveWebappBaseUrl(env), source: 'default' };
}

function pathModeEnabled(env: NodeJS.ProcessEnv): boolean {
    return env.NODE_ENV === 'development'
        && parseBooleanEnv(env.HAPPIER_DEV_PREVIEW_RELAY_PATH_MODE_ENABLED, true);
}

function disabled(
    reason: HostPreviewDisabledReason,
    params: Readonly<{
        source: 'none' | HostPreviewBaseDomainSource;
        effectiveWebUrl: string;
        effectiveWebUrlSource: EffectiveWebUrlSource;
        fatal: boolean;
    }>,
): HostPreviewBaseDomainResolution {
    return { enabled: false, reason, ...params };
}

export function resolveHostPreviewBaseDomain(env: NodeJS.ProcessEnv = process.env): HostPreviewBaseDomainResolution {
    if (!parseBooleanEnv(env.HAPPIER_FEATURE_SESSIONS_DEV_PREVIEW_RELAY__ENABLED, true)) {
        return disabled('relay_disabled', {
            source: 'none',
            effectiveWebUrl: resolveEffectiveWebappBaseUrl(env),
            effectiveWebUrlSource: 'default',
            fatal: false,
        });
    }

    const web = resolveWebUrl(env);
    let webUrl: URL;
    try {
        webUrl = new URL(web.url);
    } catch {
        return disabled('invalid_web_url', {
            source: 'derived',
            effectiveWebUrl: web.url,
            effectiveWebUrlSource: web.source,
            fatal: true,
        });
    }

    const explicitBaseDomainRaw = String(env.HAPPIER_DEV_PREVIEW_RELAY_HOST_BASE_DOMAIN ?? '').trim();
    if (explicitBaseDomainRaw) {
        const baseDomain = normalizeBaseDomain(explicitBaseDomainRaw);
        if (!baseDomain) {
            return disabled('invalid_preview_base_domain', {
                source: 'explicit',
                effectiveWebUrl: web.url,
                effectiveWebUrlSource: web.source,
                fatal: true,
            });
        }

        const previewHostname = `hp-test.${baseDomain}`;
        const previewSite = computePreviewSite(previewHostname);
        const webSite = computePreviewSite(webUrl.hostname);
        if (!previewSite || !webSite || !isSamePreviewSite(webUrl.hostname, previewHostname)) {
            return disabled('cross_site_preview_base_domain', {
                source: 'explicit',
                effectiveWebUrl: web.url,
                effectiveWebUrlSource: web.source,
                fatal: true,
            });
        }

        return {
            enabled: true,
            baseDomain,
            source: 'explicit',
            effectiveWebUrl: web.url,
            effectiveWebUrlSource: web.source,
            webSite,
            previewSite,
        };
    }

    if (web.source === 'default') {
        return disabled('default_web_url_not_derivable', {
            source: 'derived',
            effectiveWebUrl: web.url,
            effectiveWebUrlSource: web.source,
            fatal: !pathModeEnabled(env),
        });
    }

    if (!isHostWildcardableForPreview(webUrl.hostname)) {
        return disabled(pathModeEnabled(env) ? 'path_mode_only' : 'web_host_not_wildcardable', {
            source: 'derived',
            effectiveWebUrl: web.url,
            effectiveWebUrlSource: web.source,
            fatal: !pathModeEnabled(env),
        });
    }

    const webSite = computePreviewSite(webUrl.hostname);
    const previewSite = computePreviewSite(`hp-test.${webUrl.hostname}`);
    if (!webSite || !previewSite || webSite !== previewSite) {
        return disabled('cross_site_preview_base_domain', {
            source: 'derived',
            effectiveWebUrl: web.url,
            effectiveWebUrlSource: web.source,
            fatal: true,
        });
    }

    return {
        enabled: true,
        baseDomain: webUrl.hostname.toLowerCase(),
        source: 'derived',
        effectiveWebUrl: web.url,
        effectiveWebUrlSource: web.source,
        webSite,
        previewSite,
    };
}
