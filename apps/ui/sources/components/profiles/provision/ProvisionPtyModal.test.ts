import { describe, expect, it } from 'vitest';

import { shouldRenderProvisionFooter } from './ProvisionPtyModal';

describe('shouldRenderProvisionFooter', () => {
    it('does not render a redundant footer action for any provision phase', () => {
        expect(shouldRenderProvisionFooter({ phaseKind: 'running', hasPreparedSession: false })).toBe(false);
        expect(shouldRenderProvisionFooter({ phaseKind: 'success', hasPreparedSession: true })).toBe(false);
        expect(shouldRenderProvisionFooter({ phaseKind: 'success', hasPreparedSession: false })).toBe(false);
        expect(shouldRenderProvisionFooter({ phaseKind: 'error', hasPreparedSession: false })).toBe(false);
    });
});
