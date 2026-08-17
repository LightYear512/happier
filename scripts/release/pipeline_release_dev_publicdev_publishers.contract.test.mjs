import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReleaseCliDryRunEnv, RELEASE_CLI_DRY_RUN_TIMEOUT_MS } from './releaseCliDryRunTestkit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('pipeline CLI release can inspect public dev release facts without predicting nightly publisher jobs', async () => {
    const stub = createReleaseCliDryRunEnv();
    try {
        const out = execFileSync(
            process.execPath,
            [
                resolve(repoRoot, 'scripts', 'pipeline', 'run.mjs'),
                'release',
                '--confirm',
                'release dev to dev',
                '--deploy-environment',
                'dev',
                '--deploy-targets',
                'ui,server,server_runner,cli,stack',
                '--force-deploy',
                'true',
                '--repository',
                'happier-dev/happier',
                '--dry-run',
            ],
            {
                cwd: repoRoot,
                env: {
                    ...stub.env,
                    NPM_TOKEN: 'npm-token',
                    GH_TOKEN: '',
                    GH_REPO: '',
                    GITHUB_REPOSITORY: '',
                },
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: RELEASE_CLI_DRY_RUN_TIMEOUT_MS,
            },
        );

        assert.match(out, /\[pipeline\] release: environment=dev confirm=release dev to dev/);
        assert.match(out, /\[pipeline\] rolling version suffix: dev\./);
        assert.match(out, /\[pipeline\] dry-run: hosted dispatch is owned by nightly-dev\.yml/);
        assert.match(out, /- deploy_targets: ui,server,server_runner,cli,stack/);
        assert.match(out, /- force_deploy: true/);
        assert.doesNotMatch(out, /runPublish|runDeploy/);
    } finally {
        stub.cleanup();
    }
});

test('pipeline CLI release can dry-run the public dev lane in a fork without preview or main branches', async () => {
    const stub = createReleaseCliDryRunEnv(process.env, { missingRemoteBranches: ['main', 'preview'] });
    try {
        const out = execFileSync(
            process.execPath,
            [
                resolve(repoRoot, 'scripts', 'pipeline', 'run.mjs'),
                'release',
                '--confirm',
                'release dev to dev',
                '--deploy-environment',
                'dev',
                '--deploy-targets',
                'ui,server,server_runner,cli,stack',
                '--force-deploy',
                'true',
                '--repository',
                'LightYear512/happier',
                '--npm-mode',
                'pack+publish',
                '--dry-run',
                '--secrets-source',
                'env',
            ],
            {
                cwd: repoRoot,
                env: {
                    ...stub.env,
                    NPM_TOKEN: 'npm-token',
                    GH_TOKEN: '',
                    GH_REPO: '',
                    GITHUB_REPOSITORY: '',
                },
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: RELEASE_CLI_DRY_RUN_TIMEOUT_MS,
            },
        );

        assert.match(out, /\[pipeline\] release: environment=dev confirm=release dev to dev/);
        assert.match(out, /\[pipeline\] release: fetching origin dev for plan/);
        assert.match(out, /\[pipeline\] release plan: changed components \(dev-only working ref\)/);
        assert.doesNotMatch(out, /origin main\/dev\/preview/);
        assert.match(out, /\[pipeline\] dry-run: would run/);
        assert.match(out, /- runPublishUiWeb: true/);
        assert.match(out, /- runPublishServerRuntime: true/);
        assert.match(out, /- runPublishCliBinaries: true/);
    } finally {
        stub.cleanup();
    }
});

test('pipeline CLI release can dry-run web and cli binary tarballs without npm package lane', async () => {
    const stub = createReleaseCliDryRunEnv(process.env, { missingRemoteBranches: ['main', 'preview'] });
    try {
        const out = execFileSync(
            process.execPath,
            [
                resolve(repoRoot, 'scripts', 'pipeline', 'run.mjs'),
                'release',
                '--confirm',
                'release dev to dev',
                '--deploy-environment',
                'dev',
                '--deploy-targets',
                'ui,cli',
                '--force-deploy',
                'true',
                '--repository',
                'LightYear512/happier',
                '--npm-mode',
                'none',
                '--dry-run',
                '--secrets-source',
                'env',
            ],
            {
                cwd: repoRoot,
                env: {
                    ...stub.env,
                    NPM_TOKEN: '',
                    GH_TOKEN: '',
                    GH_REPO: '',
                    GITHUB_REPOSITORY: '',
                },
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: RELEASE_CLI_DRY_RUN_TIMEOUT_MS,
            },
        );

        assert.match(out, /\[pipeline\] release: fetching origin dev for plan/);
        assert.match(out, /- runPublishUiWeb: true/);
        assert.match(out, /- runPublishDocker: true/);
        assert.match(out, /- runPublishCliBinaries: true/);
        assert.match(out, /- runPublishNpm: false/);
        assert.match(out, /- runPublishServerRuntime: false/);
        assert.match(out, /- runDeployDocs: false/);
    } finally {
        stub.cleanup();
    }
});
