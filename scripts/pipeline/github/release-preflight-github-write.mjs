// @ts-check

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function formatExecError(err) {
  if (err instanceof Error) {
    const stderr = 'stderr' in err ? String(err.stderr ?? '') : '';
    const stdout = 'stdout' in err ? String(err.stdout ?? '') : '';
    return `${stderr}\n${stdout}\n${err.message}`.trim();
  }
  return String(err);
}

/**
 * @param {string} repo
 */
function validateRepository(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) {
    fail(`--repository must be owner/repo (got: ${repo || '<empty>'})`);
  }
}

/**
 * @param {string} sha
 */
function validateSha(sha) {
  if (!/^[a-fA-F0-9]{40}$/u.test(sha)) {
    fail(`--target-sha must be a 40-character Git SHA (got: ${sha || '<empty>'})`);
  }
}

/**
 * @param {string} tag
 */
function validateTag(tag) {
  if (!tag || tag.startsWith('-') || tag.includes('..') || /[\s~^:?*[\\]/u.test(tag)) {
    fail(`--tag must be a safe Git tag name (got: ${tag || '<empty>'})`);
  }
  try {
    execFileSync('git', ['check-ref-format', `refs/tags/${tag}`], {
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
      timeout: 5_000,
    });
  } catch (err) {
    fail(`--tag must be a valid Git tag name: ${formatExecError(err)}`);
  }
}

/**
 * @param {string} apiPath
 * @param {string[]} args
 */
function ghApi(apiPath, args) {
  return execFileSync('gh', ['api', ...args, apiPath], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 30_000,
  });
}

const { values } = parseArgs({
  options: {
    repository: { type: 'string' },
    'target-sha': { type: 'string' },
    tag: { type: 'string' },
  },
});

const repository = String(values.repository || process.env.GH_REPO || process.env.GITHUB_REPOSITORY || '').trim();
const targetSha = String(values['target-sha'] || '').trim();
const tag = String(values.tag || '').trim();

validateRepository(repository);
validateSha(targetSha);
validateTag(tag);

if (!String(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim()) {
  fail('GH_TOKEN or GITHUB_TOKEN is required for the GitHub release write preflight');
}

const ref = `refs/tags/${tag}`;
const refApiPath = `repos/${repository}/git/refs/tags/${tag}`;
let created = false;

try {
  ghApi(`repos/${repository}/git/refs`, ['-X', 'POST', '-f', `ref=${ref}`, '-f', `sha=${targetSha}`]);
  created = true;
  console.log(`Created release write preflight tag ${ref}`);
} catch (err) {
  fail(`Failed to create release write preflight tag ${ref}: ${formatExecError(err)}`);
}

try {
  ghApi(refApiPath, ['-X', 'DELETE']);
  console.log(`Deleted release write preflight tag ${ref}`);
} catch (err) {
  const message = `Failed to delete release write preflight tag ${ref}: ${formatExecError(err)}`;
  if (created) fail(message);
  console.error(message);
}
