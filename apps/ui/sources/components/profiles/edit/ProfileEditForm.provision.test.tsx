import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { buildBackendTargetKey } from '@happier-dev/protocol';
import { renderScreen } from '@/dev/testkit';
import type { AIBackendProfile } from '@/sync/domains/profiles/profileCompatibility';
import {
    installProfileEditFormModuleMocks,
    profileEditFormTestState,
    resetProfileEditFormTestState,
} from './profileEditFormTestHelpers';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const capture = vi.hoisted(() => ({
    provisionPress: null as null | (() => void),
    provisionTitle: null as null | string,
    provisionSubtitle: undefined as undefined | string,
    reset() {
        this.provisionPress = null;
        this.provisionTitle = null;
        this.provisionSubtitle = undefined;
    },
}));

resetProfileEditFormTestState();

installProfileEditFormModuleMocks({
    storageModule: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSetting: (key: string) => {
                if (key === 'newSessionDefaultPersistenceModeV1') return 'persisted';
                if (key === 'newSessionDefaultPersistenceModeByTargetKeyV1') return {};
                if (key === 'sessionDefaultPermissionModeByTargetKey') return {};
                return {};
            },
            useAllMachines: () => [{ id: 'machine-1', metadata: { displayName: 'Machine One' }, active: true }],
            useMachine: (id: string) => (id === 'machine-1' ? { id: 'machine-1', metadata: { displayName: 'Machine One' }, active: true } : null),
            useSettings: () => ({
                acpCatalogSettingsV1: { v: 2, backends: [] },
                backendEnabledByTargetKey: {},
            }),
            useSettingMutable: (key: string) => {
                if (key === 'favoriteMachines') return [[], vi.fn()] as const;
                if (key === 'secrets') return [[], vi.fn()] as const;
                if (key === 'secretBindingsByProfileId') return [{}, vi.fn()] as const;
                return [[], vi.fn()] as const;
            },
        });
    },
});

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => false,
}));

vi.mock('@/agents/hooks/useEnabledAgentIds', () => ({
    useEnabledAgentIds: () => ['claude', 'codex'],
}));

vi.mock('@/agents/catalog/catalog', () => ({
    AGENT_IDS: ['claude', 'codex'],
    DEFAULT_AGENT_ID: 'claude',
    getAgentCore: (agentId: string) => ({
        displayNameKey: agentId === 'codex' ? 'agentInput.agent.codex' : 'agentInput.agent.claude',
        subtitleKey: 'profiles.aiBackend.subtitle',
        permissions: { modeGroup: agentId === 'claude' ? 'claude' : 'codexLike' },
        cli: { machineLoginKey: agentId, spawnAgent: agentId },
        ui: { agentPickerIconName: 'terminal-outline' },
        sessionStorage: { direct: false },
        profileProvisioning: agentId === 'claude' ? { backendId: 'claude' } : { backendId: 'codex' },
        autoProvisionedEnvVars: agentId === 'claude' ? ['CLAUDE_CONFIG_DIR'] : ['CODEX_HOME'],
    }),
    getAgentBehavior: () => ({
        newSession: { supportsTranscriptStorageMode: () => false },
    }),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: ({ title, onPress, subtitle }: { title?: string; onPress?: () => void; subtitle?: string }) => {
        if (title === 'profiles.provision.provisionOnMachine agentInput.agent.claude') {
            capture.provisionPress = onPress ?? null;
            capture.provisionTitle = title;
            capture.provisionSubtitle = subtitle;
        }
        return React.createElement('Item', { title, onPress, subtitle });
    },
}));

function buildProfile(): AIBackendProfile {
    return {
        id: 'profile-1',
        name: 'Profile One',
        environmentVariables: [],
        defaultPermissionModeByAgent: {},
        defaultPermissionModeByTargetKey: {},
        defaultPersistenceModeByAgent: {},
        defaultPersistenceModeByTargetKey: {},
        compatibility: { claude: true, codex: false },
        compatibilityByTargetKey: {
            [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'claude' })]: true,
            [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'codex' })]: false,
        },
        envVarRequirements: [],
        isBuiltIn: false,
        createdAt: 0,
        updatedAt: 0,
        version: '1.0.0',
    };
}

describe('ProfileEditForm profile provisioning entrypoint', () => {
    it('renders a provision action for compatible provisionable targets on the selected machine', async () => {
        capture.reset();
        profileEditFormTestState.modalShowSpy.mockReset();

        const { ProfileEditForm } = await import('./ProfileEditForm');

        await renderScreen(<ProfileEditForm
            profile={buildProfile()}
            machineId="machine-1"
            onSave={() => true}
            onCancel={vi.fn()}
        />);

        expect(capture.provisionPress).toBeTruthy();
        expect(capture.provisionTitle).toBe('profiles.provision.provisionOnMachine agentInput.agent.claude');
        expect(capture.provisionSubtitle).toBeUndefined();

        await act(async () => {
            capture.provisionPress?.();
        });

        expect(profileEditFormTestState.modalShowSpy).toHaveBeenCalledWith(expect.objectContaining({
            props: expect.objectContaining({
                profileId: 'profile-1',
                backendId: 'claude',
                machineId: 'machine-1',
            }),
        }));
    });
});
