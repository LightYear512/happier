import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(resolve(packageDir, 'dist'), { recursive: true, force: true });
