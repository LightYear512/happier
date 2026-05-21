type ParamValue = string | string[] | undefined;

type ServerSettingsRouteParams = Readonly<{ url?: ParamValue; auto?: ParamValue; source?: ParamValue }>;

export type ServerSettingsRouteHref =
    | '/settings/server'
    | Readonly<{
        pathname: '/settings/server';
        params: Readonly<Partial<Record<'auto' | 'source' | 'url', string>>>;
    }>;

function firstString(value: ParamValue): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value[0] ?? '';
    return '';
}

function parseBoolean(value: string): boolean {
    const v = value.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function parseSource(value: string): 'notification' | null {
    const v = value.trim().toLowerCase();
    if (v === 'notification') return 'notification';
    return null;
}

export function buildServerSettingsRouteHref(params: ServerSettingsRouteParams): ServerSettingsRouteHref {
    const routeParams: Partial<Record<'auto' | 'source' | 'url', string>> = {};
    const auto = firstString(params.auto).trim();
    const source = firstString(params.source).trim();
    const url = firstString(params.url).trim();

    if (auto) routeParams.auto = auto;
    if (source) routeParams.source = source;
    if (url) routeParams.url = url;

    if (Object.keys(routeParams).length === 0) {
        return '/settings/server';
    }

    return {
        pathname: '/settings/server',
        params: routeParams,
    };
}

export function parseServerSettingsRouteParams(params: ServerSettingsRouteParams): Readonly<{ url: string | null; auto: boolean; source: 'notification' | null }> {
    const url = firstString(params.url).trim();
    const autoRaw = firstString(params.auto);
    const sourceRaw = firstString(params.source);
    return {
        url: url ? url : null,
        auto: autoRaw ? parseBoolean(autoRaw) : false,
        source: sourceRaw ? parseSource(sourceRaw) : null,
    };
}
