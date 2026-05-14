import { describe, expect, it } from 'vitest';

import { buildQuickInstallMcpDraft, listMcpQuickInstallPresets } from './mcpQuickInstallCatalog';

describe('mcpQuickInstallCatalog', () => {
    it('lists the curated dev-core presets', () => {
        expect(listMcpQuickInstallPresets().map((preset) => preset.id)).toEqual([
            'playwright',
            'visual-runner',
            'context7',
            'sequential-thinking',
            'github',
        ]);
    });

    it('builds the Visual Runner preset as a local stdio runner', () => {
        const draft = buildQuickInstallMcpDraft('visual-runner');

        expect(draft.inputs).toEqual([]);
        expect(draft.server).toMatchObject({
            name: 'visual_runner',
            title: 'Visual Runner',
            transport: 'stdio',
            stdio: {
                command: 'npx',
                args: ['-y', '@happier-dev/visual-runner@latest', 'mcp'],
            },
            env: {},
        });
    });

    it('builds the GitHub preset with an input-backed token requirement', () => {
        const draft = buildQuickInstallMcpDraft('github');

        expect(draft.inputs).toEqual([
            {
                inputId: 'github_token',
                title: 'GitHub token',
                description: 'Token used by the GitHub MCP server.',
                secret: true,
                suggestedEnvVarName: 'GITHUB_TOKEN',
            },
        ]);
        expect(draft.server).toMatchObject({
            name: 'github',
            transport: 'stdio',
            stdio: {
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-github'],
            },
            env: {
                GITHUB_TOKEN: {
                    t: 'input',
                    inputId: 'github_token',
                },
            },
        });
    });
});
