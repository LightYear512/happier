import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const uiRoot = join(__dirname, '..');
const patchPath = join(uiRoot, 'patches/react-native-enriched-markdown+0.5.0.patch');

function androidPatchHunkFor(filePath: string): string {
    const patch = readFileSync(patchPath, 'utf8');
    const startMarker = `diff --git a/node_modules/react-native-enriched-markdown/${filePath}`;
    const start = patch.indexOf(startMarker);
    expect(start).toBeGreaterThanOrEqual(0);

    const next = patch.indexOf('\ndiff --git ', start + 1);
    return next === -1 ? patch.slice(start) : patch.slice(start, next);
}

function addedLines(patchHunk: string): string {
    return patchHunk
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .join('\n');
}

describe('react-native-enriched-markdown Android selection patch', () => {
    it('keeps selectable TextViews on Android system selection movement instead of LinkMovementMethod', () => {
        const textViewSetupPatch = androidPatchHunkFor(
            'android/src/main/java/com/swmansion/enriched/markdown/utils/text/view/TextViewSetup.kt',
        );

        const additions = addedLines(textViewSetupPatch);

        expect(textViewSetupPatch).toContain('-  movementMethod = LinkLongPressMovementMethod.createInstance()');
        expect(additions).not.toContain('movementMethod = LinkLongPressMovementMethod.createInstance()');
    });
});
