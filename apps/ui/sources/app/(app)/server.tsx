import * as React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { buildServerSettingsRouteHref } from '@/components/settings/server/navigation/serverSettingsRouteParams';

export default function ServerConfigRoute() {
    const params = useLocalSearchParams<{
        auto?: string | string[];
        source?: string | string[];
        url?: string | string[];
    }>();

    return <Redirect href={buildServerSettingsRouteHref(params)} />;
}
