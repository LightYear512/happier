import { describe, expect, it } from 'vitest';
import { appPaneReduce, createAppPaneState } from './appPaneReducer';

function createFileTab(path: string) {
    return { key: `file:${path}`, kind: 'file', title: path.split('/').at(-1) ?? path, resource: { path } };
}

function createLocalServicePreviewTab(resourceId: string) {
    return {
        key: `localServicePreview:${resourceId}`,
        kind: 'localServicePreview',
        title: resourceId,
        resource: { kind: 'localServicePreview', resourceId },
    };
}

function createSimulatorPreviewTab(simulatorSessionId: string) {
    return {
        key: `simulatorPreview:${simulatorSessionId}`,
        kind: 'simulatorPreview',
        title: simulatorSessionId,
        resource: { kind: 'simulatorPreview', simulatorSessionId },
    };
}

describe('appPaneReduce', () => {
    it('creates and activates scopes, keeping an LRU order', () => {
        let state = createAppPaneState({ maxScopesInMemory: 3 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:2' });
        expect(state.activeScopeId).toBe('session:2');
        expect(state.scopeLru).toEqual(['session:2', 'session:1']);
    });

    it('does not clear details tabs when closing the details pane', () => {
        let state = createAppPaneState({ maxScopesInMemory: 3 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });
        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('README.md'), openAs: 'pinned' });
        state = appPaneReduce(state, { type: 'closeDetails', scopeId: 'session:1' });
        expect(state.scopes['session:1']?.details.isOpen).toBe(false);
        expect(state.scopes['session:1']?.details.tabs.map((t) => t.key)).toEqual(['file:README.md']);
    });

    it('supports preview-tab behavior (single preview slot) and pinning', () => {
        let state = createAppPaneState({ maxScopesInMemory: 3 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });

        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('a.txt'), openAs: 'preview' });
        expect(state.scopes['session:1']?.details.tabs.map((t) => [t.key, t.isPreview, t.isPinned])).toEqual([
            ['file:a.txt', true, false],
        ]);

        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('b.txt'), openAs: 'preview' });
        expect(state.scopes['session:1']?.details.tabs.map((t) => t.key)).toEqual(['file:b.txt']);
        expect(state.scopes['session:1']?.details.tabs[0]?.isPreview).toBe(true);

        state = appPaneReduce(state, { type: 'pinDetailsTab', scopeId: 'session:1', tabKey: 'file:b.txt' });
        expect(state.scopes['session:1']?.details.tabs.map((t) => [t.key, t.isPreview, t.isPinned])).toEqual([
            ['file:b.txt', false, true],
        ]);

        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('c.txt'), openAs: 'preview' });
        expect(state.scopes['session:1']?.details.tabs.map((t) => [t.key, t.isPreview, t.isPinned])).toEqual([
            ['file:b.txt', false, true],
            ['file:c.txt', true, false],
        ]);

        // Opening an existing preview tab as pinned should pin it (no duplicates).
        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('c.txt'), openAs: 'pinned' });
        expect(state.scopes['session:1']?.details.tabs.map((t) => [t.key, t.isPreview, t.isPinned])).toEqual([
            ['file:b.txt', false, true],
            ['file:c.txt', false, true],
        ]);
    });

    it('supports unpinning a details tab back into the preview slot', () => {
        let state = createAppPaneState({ maxScopesInMemory: 3 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });

        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('a.txt'), openAs: 'pinned' });
        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('b.txt'), openAs: 'preview' });
        expect(state.scopes['session:1']?.details.tabs.map((t) => [t.key, t.isPreview, t.isPinned])).toEqual([
            ['file:a.txt', false, true],
            ['file:b.txt', true, false],
        ]);

        state = appPaneReduce(state, { type: 'unpinDetailsTab', scopeId: 'session:1', tabKey: 'file:a.txt' });

        // Unpinned tab becomes the sole preview; existing preview is removed.
        expect(state.scopes['session:1']?.details.tabs.map((t) => [t.key, t.isPreview, t.isPinned])).toEqual([
            ['file:a.txt', true, false],
        ]);
        expect(state.scopes['session:1']?.details.activeTabKey).toBe('file:a.txt');
    });

    it('keeps local service preview tabs separate from the file preview slot', () => {
        let state = createAppPaneState({ maxScopesInMemory: 3 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });

        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createLocalServicePreviewTab('preview_1'), openAs: 'preview' });
        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createLocalServicePreviewTab('preview_2'), openAs: 'preview' });
        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('a.txt'), openAs: 'preview' });

        expect(state.scopes['session:1']?.details.tabs.map((t) => [t.key, t.isPreview, t.isPinned])).toEqual([
            ['localServicePreview:preview_1', true, false],
            ['localServicePreview:preview_2', true, false],
            ['file:a.txt', true, false],
        ]);

        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('b.txt'), openAs: 'preview' });

        expect(state.scopes['session:1']?.details.tabs.map((t) => [t.key, t.isPreview, t.isPinned])).toEqual([
            ['localServicePreview:preview_1', true, false],
            ['localServicePreview:preview_2', true, false],
            ['file:b.txt', true, false],
        ]);
    });

    it('keeps simulator preview tabs separate from the file preview slot', () => {
        let state = createAppPaneState({ maxScopesInMemory: 3 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });

        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createSimulatorPreviewTab('sim_1'), openAs: 'preview' });
        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('app.tsx'), openAs: 'preview' });

        expect(state.scopes['session:1']?.details.tabs.map((t) => [t.key, t.isPreview, t.isPinned])).toEqual([
            ['simulatorPreview:sim_1', true, false],
            ['file:app.tsx', true, false],
        ]);
        expect(state.scopes['session:1']?.details.activeTabKey).toBe('file:app.tsx');
    });

    it('unpins local service preview tabs without removing other local previews', () => {
        let state = createAppPaneState({ maxScopesInMemory: 3 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });

        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createLocalServicePreviewTab('preview_1'), openAs: 'preview' });
        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createLocalServicePreviewTab('preview_2'), openAs: 'pinned' });
        state = appPaneReduce(state, { type: 'unpinDetailsTab', scopeId: 'session:1', tabKey: 'localServicePreview:preview_2' });

        expect(state.scopes['session:1']?.details.tabs.map((t) => [t.key, t.isPreview, t.isPinned])).toEqual([
            ['localServicePreview:preview_1', true, false],
            ['localServicePreview:preview_2', true, false],
        ]);
        expect(state.scopes['session:1']?.details.activeTabKey).toBe('localServicePreview:preview_2');
    });

    it('evicts least-recently-used scopes beyond the max', () => {
        let state = createAppPaneState({ maxScopesInMemory: 2 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });
        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('a.txt'), openAs: 'pinned' });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:2' });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:3' });

        expect(Object.keys(state.scopes).sort()).toEqual(['session:2', 'session:3']);
        expect(state.scopes['session:1']).toBeUndefined();
    });

    it('retains right tab state across open/close cycles', () => {
        let state = createAppPaneState({ maxScopesInMemory: 3 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });
        state = appPaneReduce(state, { type: 'openRight', scopeId: 'session:1', tabId: 'git' });
        state = appPaneReduce(state, {
            type: 'setRightTabState',
            scopeId: 'session:1',
            tabId: 'git',
            nextState: { commitMessageDraft: 'wip: draft' },
        });
        state = appPaneReduce(state, { type: 'closeRight', scopeId: 'session:1' });
        state = appPaneReduce(state, { type: 'openRight', scopeId: 'session:1', tabId: 'git' });

        expect(state.scopes['session:1']?.right.tabState.git).toEqual({ commitMessageDraft: 'wip: draft' });
    });

    it('retains bottom tab state across open/close cycles', () => {
        let state = createAppPaneState({ maxScopesInMemory: 3 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });

        state = appPaneReduce(state, { type: 'openBottom', scopeId: 'session:1', tabId: 'terminal' });

        state = appPaneReduce(state, { type: 'setBottomTabState', scopeId: 'session:1', tabId: 'terminal', nextState: { history: ['echo hello'] } });

        state = appPaneReduce(state, { type: 'closeBottom', scopeId: 'session:1' });
        state = appPaneReduce(state, { type: 'openBottom', scopeId: 'session:1', tabId: 'terminal' });

        expect(state.scopes['session:1']?.bottom.tabState.terminal).toEqual({ history: ['echo hello'] });
    });

    it('keeps focus mode scoped to the active pane scope, not the active details tab', () => {
        let state = createAppPaneState({ maxScopesInMemory: 3 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });
        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('a.txt'), openAs: 'pinned' });
        state = appPaneReduce(state, { type: 'enterFocusMode', scopeId: 'session:1' });

        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('b.txt'), openAs: 'pinned' });
        expect(state.focusMode.scopeId).toBe('session:1');

        state = appPaneReduce(state, { type: 'setActiveDetailsTab', scopeId: 'session:1', tabKey: 'file:a.txt' });
        expect(state.focusMode.scopeId).toBe('session:1');

        state = appPaneReduce(state, { type: 'pinDetailsTab', scopeId: 'session:1', tabKey: 'file:a.txt' });
        expect(state.focusMode.scopeId).toBe('session:1');

        state = appPaneReduce(state, { type: 'unpinDetailsTab', scopeId: 'session:1', tabKey: 'file:a.txt' });
        expect(state.focusMode.scopeId).toBe('session:1');
    });

    it('clears focus mode when navigation activates a different scope', () => {
        let state = createAppPaneState({ maxScopesInMemory: 3 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });
        state = appPaneReduce(state, { type: 'openRight', scopeId: 'session:1', tabId: 'files' });
        state = appPaneReduce(state, { type: 'enterFocusMode', scopeId: 'session:1' });

        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:2' });

        expect(state.focusMode.scopeId).toBeNull();
    });

    it('clears focus mode when the focused scope no longer has right or details panes open', () => {
        let state = createAppPaneState({ maxScopesInMemory: 3 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });
        state = appPaneReduce(state, { type: 'openRight', scopeId: 'session:1', tabId: 'files' });
        state = appPaneReduce(state, { type: 'openDetailsTab', scopeId: 'session:1', tab: createFileTab('a.txt'), openAs: 'pinned' });
        state = appPaneReduce(state, { type: 'enterFocusMode', scopeId: 'session:1' });

        state = appPaneReduce(state, { type: 'closeDetailsTab', scopeId: 'session:1', tabKey: 'file:a.txt' });
        expect(state.focusMode.scopeId).toBe('session:1');

        state = appPaneReduce(state, { type: 'closeRight', scopeId: 'session:1' });
        expect(state.focusMode.scopeId).toBeNull();
    });

    it('clears focus mode when the focused scope is evicted', () => {
        let state = createAppPaneState({ maxScopesInMemory: 2 });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:1' });
        state = appPaneReduce(state, { type: 'openRight', scopeId: 'session:1', tabId: 'files' });
        state = appPaneReduce(state, { type: 'enterFocusMode', scopeId: 'session:1' });

        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:2' });
        state = appPaneReduce(state, { type: 'activateScope', scopeId: 'session:3' });

        expect(state.scopes['session:1']).toBeUndefined();
        expect(state.focusMode.scopeId).toBeNull();
    });
});
