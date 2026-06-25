import { describe, expect, it } from 'vitest';

import {
    computePreviewSite,
    isHostWildcardableForPreview,
    isSamePreviewSite,
} from './previewSite';

describe('previewSite', () => {
    it('treats loopback wildcard domains as same-site', () => {
        expect(computePreviewSite('127.0.0.1.nip.io')).toBe('127.0.0.1.nip.io');
        expect(computePreviewSite('hp-abc.127.0.0.1.nip.io')).toBe('127.0.0.1.nip.io');
        expect(isSamePreviewSite('127.0.0.1.nip.io', 'hp-abc.127.0.0.1.nip.io')).toBe(true);

        expect(computePreviewSite('127.0.0.1.sslip.io')).toBe('127.0.0.1.sslip.io');
        expect(computePreviewSite('hp-abc.127.0.0.1.sslip.io')).toBe('127.0.0.1.sslip.io');
        expect(isSamePreviewSite('lvh.me', 'hp-abc.lvh.me')).toBe(true);
    });

    it('uses registrable domain behavior for ordinary domains', () => {
        expect(computePreviewSite('app.example.com')).toBe('example.com');
        expect(computePreviewSite('hp-abc.preview.example.com')).toBe('example.com');
        expect(isSamePreviewSite('app.example.com', 'hp-abc.preview.example.com')).toBe(true);
        expect(isSamePreviewSite('app.example.com', 'badexample.com')).toBe(false);
    });

    it('rejects hosts that cannot support wildcard preview derivation', () => {
        expect(isHostWildcardableForPreview('127.0.0.1')).toBe(false);
        expect(isHostWildcardableForPreview('localhost')).toBe(false);
        expect(isHostWildcardableForPreview('::1')).toBe(false);
        expect(isHostWildcardableForPreview('app.example.com')).toBe(true);
        expect(isHostWildcardableForPreview('127.0.0.1.nip.io')).toBe(true);
    });
});
