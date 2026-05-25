import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { codexProfileAuthProvider } from './profileAuth';

describe('codexProfileAuthProvider', () => {
  it('starts Codex profile login in device auth mode without automatic responder input', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'happier-codex-profile-auth-'));
    const codexPath = join(tempDir, 'codex');
    await writeFile(codexPath, '#!/bin/sh\necho ok\n', 'utf8');
    await chmod(codexPath, 0o755);

    const context = await codexProfileAuthProvider.buildIsolatedLoginContext({
      profileDir: '/tmp/happier/profiles/codex/work',
      processEnv: {
        PATH: '/usr/bin',
        HAPPIER_CODEX_PATH: codexPath,
      },
    });

    expect(context.command).toBe(codexPath);
    expect(context.args).toEqual(['login', '--device-auth']);
    expect(context.env.CODEX_HOME).toBe('/tmp/happier/profiles/codex/work');
    expect(context.allowlistedEnvKeys).toEqual(['CODEX_HOME']);
    expect(context).not.toHaveProperty('initialInput');
    expect(context).not.toHaveProperty('terminalOutputResponder');
  });
});
