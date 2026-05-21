import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const gotoNewSessionComposerFlowUrl = new URL(
  '../../../suites/mobile-e2e/flows/_shared/gotoNewSessionComposer.yaml',
  import.meta.url,
);

describe('mobile session flow contracts', () => {
  it('continues through the getting-started start button before waiting for composer input', () => {
    const flow = readFileSync(gotoNewSessionComposerFlowUrl, 'utf8');
    const headerStartTapIndex = flow.indexOf('- tapOn:\n    id: main-header-start-new-session');
    const gettingStartedStartTapIndex = flow.indexOf('id: session-getting-started-start-new-session', headerStartTapIndex);
    const composerInputWaitIndex = flow.indexOf('id: new-session-composer-input', headerStartTapIndex);

    expect(headerStartTapIndex).toBeGreaterThanOrEqual(0);
    expect(gettingStartedStartTapIndex).toBeGreaterThan(headerStartTapIndex);
    expect(gettingStartedStartTapIndex).toBeLessThan(composerInputWaitIndex);
  });
});
