import { describe, expect, it } from 'vitest';

import { buildAgentOptionTestIds } from './selectNewSessionAgent';

describe('selectNewSessionAgent', () => {
  it('includes the agent-scoped chip-picker option emitted by the current UI', () => {
    expect(buildAgentOptionTestIds('codex')).toContain('agent-input-chip-picker.option:agent:codex');
  });
});
