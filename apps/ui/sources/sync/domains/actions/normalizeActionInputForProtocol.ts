const EXECUTION_RUN_ACTION_IDS = new Set([
    'review.start',
    'subagents.plan.start',
    'subagents.delegate.start',
    'voice_agent.start',
]);

function normalizeExecutionRunPermissionMode(value: unknown): unknown {
    if (value === 'read-only') return 'read_only';
    if (value === 'safe-yolo') return 'workspace_write';
    return value;
}

export function normalizeActionInputForProtocol(
    actionId: string,
    input: Record<string, unknown>,
): Record<string, unknown> {
    if (!EXECUTION_RUN_ACTION_IDS.has(actionId)) {
        return input;
    }

    const permissionMode = normalizeExecutionRunPermissionMode(input.permissionMode);
    if (permissionMode === input.permissionMode) {
        return input;
    }

    return {
        ...input,
        permissionMode,
    };
}
