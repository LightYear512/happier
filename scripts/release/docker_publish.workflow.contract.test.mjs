import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

async function loadWorkflow(name) {
  return readFile(join(repoRoot, '.github', 'workflows', name), 'utf8');
}

test('publish-docker supports workflow_call and is wired from release workflow', async () => {
  const publishDocker = await loadWorkflow('publish-docker.yml');
  assert.match(publishDocker, /\n\s*workflow_call:\n/);
  assert.match(
    publishDocker,
    /permissions:\n\s+contents:\s+read\n\s+packages:\s+write/m,
    'publish-docker should request packages:write for GHCR pushes',
  );
  assert.match(publishDocker, /\n\s*source_ref:\n/);
  assert.match(
    publishDocker,
    /\n\s*registries:\n/,
    'publish-docker should support configuring which registries receive image pushes',
  );
  assert.match(
    publishDocker,
    /\n\s*default:\s*"?ghcr"?\n/,
    'publish-docker should default to GHCR-only publishing',
  );
  assert.match(
    publishDocker,
    /\n\s*ghcr_namespace:\n/,
    'publish-docker should allow overriding the GHCR namespace for fork publishing',
  );
  assert.doesNotMatch(
    publishDocker,
    /GHCR_NAMESPACE:\s*ghcr\.io\/happier-dev/,
    'publish-docker must not hardcode the upstream GHCR namespace',
  );
  assert.match(
    publishDocker,
    /echo "GHCR_NAMESPACE=\$\{normalized\}" >> "\$GITHUB_ENV"/,
    'publish-docker should export the resolved GHCR namespace to the pipeline environment',
  );
  assert.match(publishDocker, /\n\s*build_relay:\n/);
  assert.match(publishDocker, /\n\s*build_dev_box:\n/);
  assert.match(
    publishDocker,
    /node scripts\/pipeline\/run\.mjs docker-publish/,
    'publish-docker should delegate docker build+push to the pipeline docker-publish command',
  );
  assert.match(publishDocker, /--registries "\${{\s*inputs\.registries\s*}}"/);
  assert.match(
    publishDocker,
    /DOCKERHUB_USERNAME:\s*\${{\s*secrets\.DOCKERHUB_USERNAME\s*}}/,
    'publish-docker should pass Docker Hub username to the pipeline script',
  );
  assert.match(
    publishDocker,
    /Login to Docker Hub[\s\S]*?if:\s*\${{\s*contains\(format\(',\{0\},', inputs\.registries\), ',dockerhub,'\)\s*}}/,
    'publish-docker should skip Docker Hub login for GHCR-only runs',
  );
  assert.match(
    publishDocker,
    /DOCKERHUB_TOKEN:\s*\${{\s*secrets\.DOCKERHUB_TOKEN\s*}}/,
    'publish-docker should pass Docker Hub token to the pipeline script',
  );
  assert.match(
    publishDocker,
    /Login to GHCR/,
    'publish-docker should login to GHCR (ghcr.io)',
  );
  assert.match(
    publishDocker,
    /Login to GHCR[\s\S]*?if:\s*\${{\s*contains\(format\(',\{0\},', inputs\.registries\), ',ghcr,'\)\s*}}/,
    'publish-docker should skip GHCR login when GHCR is not selected',
  );
  assert.match(
    publishDocker,
    /RELEASE_BOT_APP_ID:\s*\${{\s*secrets\.RELEASE_BOT_APP_ID\s*}}[\s\S]*?RELEASE_BOT_PRIVATE_KEY:\s*\${{\s*secrets\.RELEASE_BOT_PRIVATE_KEY\s*}}/,
    'publish-docker should expose release bot secrets through job env for conditional steps',
  );
  assert.match(
    publishDocker,
    /Create GitHub App token[\s\S]*?if:\s*\${{\s*env\.RELEASE_BOT_APP_ID != '' && env\.RELEASE_BOT_PRIVATE_KEY != ''\s*}}/,
    'publish-docker should not require release bot secrets for self-use fork publishing',
  );
  assert.match(
    publishDocker,
    /token:\s*\${{\s*steps\.app_token\.outputs\.token != '' && steps\.app_token\.outputs\.token \|\| github\.token\s*}}/,
    'publish-docker should fall back to GITHUB_TOKEN when no release bot token is available',
  );
  assert.match(
    publishDocker,
    /registry:\s*ghcr\.io/,
    'publish-docker should use docker/login-action registry ghcr.io',
  );
  assert.match(
    publishDocker,
    /peter-evans\/dockerhub-description@/,
    'publish-docker should publish Docker Hub README/description',
  );
  assert.match(
    publishDocker,
    /Update Docker Hub README \(relay-server\)[\s\S]*?if:\s*\${{\s*inputs\.build_relay && contains\(format\(',\{0\},', inputs\.registries\), ',dockerhub,'\) && inputs\.channel != 'dev'\s*}}/,
    'publish-docker should only update Docker Hub README when Docker Hub is selected',
  );
  assert.match(
    publishDocker,
    /repository:\s*happierdev\/relay-server/,
    'publish-docker should publish relay-server Docker Hub README',
  );
  assert.match(
    publishDocker,
    /readme-filepath:\s*docker\/dockerhub\/relay-server\.md/,
    'publish-docker should use repo README file for relay-server',
  );
  assert.match(
    publishDocker,
    /repository:\s*happierdev\/dev-box/,
    'publish-docker should publish dev-box Docker Hub README',
  );
  assert.match(
    publishDocker,
    /readme-filepath:\s*docker\/dockerhub\/dev-box\.md/,
    'publish-docker should use repo README file for dev-box',
  );

  const release = await loadWorkflow('release.yml');
  assert.match(release, /publish_docker:/);
  assert.match(release, /uses:\s+\.\/\.github\/workflows\/publish-docker\.yml/);
  assert.match(release, /build_relay:/);
  assert.match(release, /build_dev_box:/);
});
