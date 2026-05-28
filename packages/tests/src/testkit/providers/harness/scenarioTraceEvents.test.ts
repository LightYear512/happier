import { describe, expect, it } from 'vitest';

import { filterScenarioRelevantTraceEvents } from './scenarioTraceEvents';

describe('filterScenarioRelevantTraceEvents', () => {
  const provider = {
    protocol: 'acp',
    traceProvider: 'codex',
  } as const;

  it('uses the provider protocol by default', () => {
    const relevant = filterScenarioRelevantTraceEvents({
      provider,
      scenario: {},
      events: [
        { v: 1, sessionId: 's1', protocol: 'acp', provider: 'codex', kind: 'tool-call', payload: {} },
        { v: 1, sessionId: 's1', protocol: 'codex', provider: 'codex', kind: 'tool-call', payload: {} },
        { v: 1, sessionId: 's1', protocol: 'acp', provider: 'other', kind: 'tool-call', payload: {} },
      ],
    });

    expect(relevant.map((event) => event.protocol)).toEqual(['acp']);
  });

  it('accepts scenario trace protocol overrides for appServer traces', () => {
    const relevant = filterScenarioRelevantTraceEvents({
      provider,
      scenario: {
        traceProtocols: ['codex'],
      },
      events: [
        { v: 1, sessionId: 's1', protocol: 'acp', provider: 'codex', kind: 'tool-call', payload: {} },
        { v: 1, sessionId: 's1', protocol: 'codex', provider: 'codex', kind: 'tool-call', payload: {} },
      ],
    });

    expect(relevant.map((event) => event.protocol)).toEqual(['codex']);
  });
});
