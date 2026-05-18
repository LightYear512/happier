import { describe, expect, it } from 'vitest';

import { CODEX_CORE } from './core';

describe('CODEX_CORE', () => {
    it('declares the daemon-managed Codex home env var', () => {
        expect(CODEX_CORE.autoProvisionedEnvVars).toEqual(['CODEX_HOME']);
    });

    it('declares Codex profile provisioning support', () => {
        expect(CODEX_CORE.profileProvisioning).toEqual({ backendId: 'codex' });
    });

    it('keeps core identity stable', () => {
        expect(CODEX_CORE.id).toBe('codex');
        expect(CODEX_CORE.uiConnectedService).toEqual({
            serviceId: 'openai',
            label: 'OpenAI Codex',
            connectRoute: null,
        });
    });
});
