import { resolveHostPreviewBaseDomain } from './hostPreviewBaseDomainResolution';

export function validateHostPreviewStartupConfig(env: NodeJS.ProcessEnv = process.env): void {
    const resolution = resolveHostPreviewBaseDomain(env);
    if (resolution.enabled || !resolution.fatal) {
        return;
    }

    throw new Error(
        [
            `Invalid session dev preview host configuration: ${resolution.reason}`,
            `source=${resolution.source}`,
            `webUrl=${resolution.effectiveWebUrl}`,
            `webUrlSource=${resolution.effectiveWebUrlSource}`,
        ].join(' '),
    );
}
