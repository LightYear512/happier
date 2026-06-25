import { getDomain } from 'tldts';

const LOOPBACK_WILDCARD_SITES = [
    '127.0.0.1.nip.io',
    '127.0.0.1.sslip.io',
    'lvh.me',
] as const;

function normalizeHostname(hostname: string): string {
    return hostname.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

function isIpHostname(hostname: string): boolean {
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':');
}

export function computePreviewSite(hostname: string): string | null {
    const normalized = normalizeHostname(hostname);
    if (!normalized || normalized === 'localhost' || isIpHostname(normalized)) {
        return null;
    }

    for (const loopbackSite of LOOPBACK_WILDCARD_SITES) {
        if (normalized === loopbackSite || normalized.endsWith(`.${loopbackSite}`)) {
            return loopbackSite;
        }
    }

    return getDomain(normalized) ?? null;
}

export function isHostWildcardableForPreview(hostname: string): boolean {
    const normalized = normalizeHostname(hostname);
    if (!normalized || normalized === 'localhost' || isIpHostname(normalized)) {
        return false;
    }
    return computePreviewSite(normalized) !== null;
}

export function isSamePreviewSite(leftHostname: string, rightHostname: string): boolean {
    const leftSite = computePreviewSite(leftHostname);
    const rightSite = computePreviewSite(rightHostname);
    return Boolean(leftSite && rightSite && leftSite === rightSite);
}
