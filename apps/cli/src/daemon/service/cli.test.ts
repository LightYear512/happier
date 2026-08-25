import { existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLaunchdPlistXml, renderSystemdServiceUnit, renderWindowsScheduledTaskWrapperPs1 } from '@happier-dev/cli-common/service';
import { withConfiguredDaemonTestHome, writeDaemonSettingsFixture } from '@/daemon/testkit/fakeDaemonLifecycle.testkit';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withTempDir } from '@/testkit/fs/tempDir';
import { captureStderr, captureStdout, captureStdoutJsonOutput } from '@/testkit/logger/captureOutput';
import type { DaemonLocallyPersistedState } from '@/persistence';
import { planDaemonServiceInstall } from './plan';
const stopDaemonMock = vi.fn(async () => undefined);
const restartDaemonAndWaitMock = vi.fn(async () => true);

function doMockChildProcessSpawnSync(
  spawnSyncImpl: (command: string, args?: readonly string[]) => unknown,
): void {
  vi.doMock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    return {
      ...actual,
      spawnSync: vi.fn(spawnSyncImpl),
    };
  });
}

const SCOPED_ENV_KEYS = [
  'HAPPIER_DAEMON_SERVICE_PLATFORM',
  'HAPPIER_DAEMON_SERVICE_USER_HOME_DIR',
  'HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR',
  'HAPPIER_DAEMON_SERVICE_INSTANCE_ID',
  'HAPPIER_DAEMON_SERVICE_NODE_PATH',
  'HAPPIER_DAEMON_SERVICE_ENTRY_PATH',
  'HAPPIER_DAEMON_SERVICE_MODE',
  'HAPPIER_DAEMON_SERVICE_SYSTEM_USER',
  'HAPPIER_DAEMON_SERVICE_CHANNEL',
  'HAPPIER_DAEMON_SERVICE_TARGET_MODE',
  'HAPPIER_PUBLIC_RELEASE_CHANNEL',
  'HAPPIER_SERVER_URL',
  'HAPPIER_PUBLIC_SERVER_URL',
  'HAPPIER_LOCAL_SERVER_URL',
  'HAPPIER_WEBAPP_URL',
  'HAPPIER_HOME_DIR',
  'HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS',
  'HAPPIER_DAEMON_SERVICE_OWNERSHIP_ACTIVE_GRACE_TIMEOUT_MS',
  'HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS',
  'HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS',
  'HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS',
  'HAPPIER_DAEMON_START_WAIT_POLL_MS',
  'HAPPIER_CLI_INVOKER_NAME',
  'PATH',
] as const;

async function loadCliModule(): Promise<typeof import('./cli.js')> {
  return import('./cli.js');
}

function writeValidInstalledDaemonServiceFile(
  installedPath: string,
  options: Readonly<{
    activeServerId?: string;
    releaseChannel?: 'stable' | 'preview' | 'dev';
    targetMode?: 'default-following' | 'pinned';
  }> = {},
): void {
  writeFileSync(
    installedPath,
    renderSystemdServiceUnit({
      description: 'Happier Daemon',
      execStart: ['/Users/tester/.happier/cli/current/happier', 'daemon', 'start-sync'],
      env: {
        HAPPIER_DAEMON_STARTUP_SOURCE: 'background-service',
        HAPPIER_DAEMON_SERVICE_TARGET_MODE: options.targetMode ?? 'default-following',
        HAPPIER_ACTIVE_SERVER_ID: options.activeServerId ?? 'cloud',
        HAPPIER_PUBLIC_RELEASE_CHANNEL: options.releaseChannel ?? 'stable',
      },
      wantedBy: 'default.target',
    }),
    'utf-8',
  );
}

function writeValidInstalledWindowsDaemonServiceFile(
    installedPath: string,
    options: Readonly<{
        activeServerId?: string;
        releaseChannel?: 'stable' | 'preview' | 'dev';
        targetMode?: 'default-following' | 'pinned';
    }> = {},
): void {
    const happierHomeDir = dirname(dirname(installedPath));
    writeFileSync(
        installedPath,
        renderWindowsScheduledTaskWrapperPs1({
            workingDirectory: 'C:\\Users\\tester',
            programArgs: ['C:\\hq\\happier.exe', 'daemon', 'start-sync'],
            env: {
                HAPPIER_HOME_DIR: happierHomeDir,
                HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
                HAPPIER_DAEMON_STARTUP_SOURCE: 'background-service',
                HAPPIER_DAEMON_SERVICE_TARGET_MODE: options.targetMode ?? 'default-following',
                HAPPIER_ACTIVE_SERVER_ID: options.activeServerId ?? 'cloud',
                HAPPIER_PUBLIC_RELEASE_CHANNEL: options.releaseChannel ?? 'stable',
            },
      stdoutPath: 'C:\\hq\\daemon.out.log',
      stderrPath: 'C:\\hq\\daemon.err.log',
    }),
    'utf-8',
  );
}

function scheduleDelayedOwnerWriteOnce(
  delayedOwnerWrites: Array<Promise<void>>,
  writeOwner: () => void,
): void {
  if (delayedOwnerWrites.length > 0) {
    return;
  }
  delayedOwnerWrites.push(new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      try {
        writeOwner();
        resolve();
      } catch (error) {
        reject(error);
      }
    }, 120);
  }));
}

describe('runDaemonServiceCliCommand', () => {
  let envScope = createEnvKeyScope(SCOPED_ENV_KEYS);

  afterEach(() => {
    envScope.restore();
    envScope = createEnvKeyScope(SCOPED_ENV_KEYS);
    stopDaemonMock.mockReset();
    restartDaemonAndWaitMock.mockReset();
    vi.restoreAllMocks();
    vi.doUnmock('node:child_process');
    vi.doUnmock('./commandExistsInPath');
    vi.doUnmock('@/daemon/controlClient');
    vi.doUnmock('@/daemon/restartDaemonAndWait');
    vi.doUnmock('@/daemon/waitForDaemonRunningWithinBudget');
    vi.unmock('node:child_process');
    vi.unmock('./commandExistsInPath');
    vi.unmock('@/daemon/controlClient');
    vi.unmock('@/daemon/restartDaemonAndWait');
    vi.unmock('@/daemon/waitForDaemonRunningWithinBudget');
    vi.unmock('node:os');
    vi.doUnmock('./resolveDaemonServiceDiscoveryTargets');
    vi.doUnmock('./resolveLinuxSystemUserPaths');
    vi.doUnmock('./discoverInstalledDaemonServiceEntries');
    vi.unmock('./resolveDaemonServiceDiscoveryTargets');
    vi.unmock('./resolveLinuxSystemUserPaths');
    vi.unmock('./discoverInstalledDaemonServiceEntries');
    vi.resetModules();
  });

  it('restores the manual daemon when service restart takeover fails to run the service command', async () => {
    await withTempDir('happier-service-restart-takeover-failure-', async (homeDir) => {
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS: '200',
        HAPPIER_DAEMON_START_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '300',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '40',
      });
      vi.resetModules();
      doMockChildProcessSpawnSync(() => ({ status: 1, stdout: Buffer.from(''), stderr: Buffer.from('systemctl restart failed') }));
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));
      vi.doMock('@/daemon/restartDaemonAndWait', () => ({
        restartDaemonAndWait: restartDaemonAndWaitMock,
      }));

      const controlClient = await import('@/daemon/controlClient');
      vi.spyOn(controlClient, 'stopDaemon').mockImplementation(stopDaemonMock);

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { writeDaemonState }, { configuration }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
        import('@/configuration'),
      ]);

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      mkdirSync(dirname(paths.installedPath), { recursive: true });
      writeValidInstalledDaemonServiceFile(paths.installedPath);

      writeDaemonState({
        pid: process.pid,
        httpPort: 43118,
        startedAt: Date.now(),
        startedWithCliVersion: '0.0.0-manual',
        startupSource: 'manual',
        runtimeId: 'runtime-1',
      });

      await expect(runDaemonServiceCliCommand({ argv: ['restart', '--takeover'] })).rejects.toThrow(/restart/i);
      expect(stopDaemonMock).toHaveBeenCalledTimes(1);
      expect(restartDaemonAndWaitMock).toHaveBeenCalledTimes(1);
    });
  });

  it('restores the manual daemon when service install takeover fails to load the service', async () => {
    await withTempDir('happier-service-install-takeover-failure-', async (homeDir) => {
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS: '200',
        HAPPIER_DAEMON_START_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '300',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '40',
      });
      vi.resetModules();
      doMockChildProcessSpawnSync(() => ({ status: 1, stdout: Buffer.from(''), stderr: Buffer.from('systemctl enable failed') }));
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));
      vi.doMock('@/daemon/restartDaemonAndWait', () => ({
        restartDaemonAndWait: restartDaemonAndWaitMock,
      }));

      const controlClient = await import('@/daemon/controlClient');
      vi.spyOn(controlClient, 'stopDaemon').mockImplementation(stopDaemonMock);

      const [{ runDaemonServiceCliCommand }, { writeDaemonState }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
      ]);

      writeDaemonState({
        pid: process.pid,
        httpPort: 43121,
        startedAt: Date.now(),
        startedWithCliVersion: '0.0.0-manual',
        startupSource: 'manual',
        runtimeId: 'runtime-1',
      });

      await expect(runDaemonServiceCliCommand({ argv: ['install', '--takeover'] })).rejects.toThrow(/install/i);
      expect(stopDaemonMock).toHaveBeenCalledTimes(1);
      expect(restartDaemonAndWaitMock).toHaveBeenCalledTimes(1);
    });
  });

  it('restores the manual daemon when service install takeover never reaches a healthy loaded service state', async () => {
    await withTempDir('happier-service-install-takeover-postcondition-', async (homeDir) => {
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
      });
      vi.resetModules();
      doMockChildProcessSpawnSync((command: string, args: readonly string[] = []) => {
        if (command === 'systemctl' && args.includes('is-active')) {
          return { status: 1, stdout: Buffer.from(''), stderr: Buffer.from('inactive') };
        }
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));
      vi.doMock('@/daemon/restartDaemonAndWait', () => ({
        restartDaemonAndWait: restartDaemonAndWaitMock,
      }));

      const controlClient = await import('@/daemon/controlClient');
      vi.spyOn(controlClient, 'stopDaemon').mockImplementation(stopDaemonMock);

      const [{ runDaemonServiceCliCommand }, { writeDaemonState }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
      ]);

      writeDaemonState({
        pid: process.pid,
        httpPort: 43124,
        startedAt: Date.now(),
        startedWithCliVersion: '0.0.0-manual',
        startupSource: 'manual',
        runtimeId: 'runtime-install-postcondition',
      });

      await expect(runDaemonServiceCliCommand({ argv: ['install', '--takeover'] })).rejects.toThrow(/service state/i);
      expect(stopDaemonMock).toHaveBeenCalledTimes(1);
      expect(restartDaemonAndWaitMock).toHaveBeenCalledTimes(1);
    });
  });

  it('restores the manual daemon when service install takeover only reaches a different background service label', async () => {
    await withTempDir('happier-service-install-takeover-other-label-', async (homeDir) => {
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
      });
      vi.resetModules();
      doMockChildProcessSpawnSync((command: string, args: readonly string[] = []) => {
        if (command === 'systemctl' && args.includes('is-active')) {
          return { status: 1, stdout: Buffer.from(''), stderr: Buffer.from('inactive') };
        }
        writeDaemonStateImpl?.({
          pid: process.pid,
          httpPort: 43125,
          startedAt: Date.now(),
          startedWithCliVersion: '0.0.0-service',
          startupSource: 'background-service',
          serviceLabel: 'different-service-label',
        });
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));
      vi.doMock('@/daemon/restartDaemonAndWait', () => ({
        restartDaemonAndWait: restartDaemonAndWaitMock,
      }));

      const controlClient = await import('@/daemon/controlClient');
      vi.spyOn(controlClient, 'stopDaemon').mockImplementation(stopDaemonMock);

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { writeDaemonState }, { configuration }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
        import('@/configuration'),
      ]);
      writeDaemonStateImpl = writeDaemonState;

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      resolveDaemonServicePaths(runtime);

      writeDaemonState({
        pid: process.pid,
        httpPort: 43126,
        startedAt: Date.now(),
        startedWithCliVersion: '0.0.0-manual',
        startupSource: 'manual',
        runtimeId: 'runtime-install-other-label',
      });

      await expect(runDaemonServiceCliCommand({ argv: ['install', '--takeover'] })).rejects.toThrow(/Failed to install|active daemon/i);
      expect(stopDaemonMock).toHaveBeenCalledTimes(1);
      expect(restartDaemonAndWaitMock).toHaveBeenCalledTimes(1);
    });
  });

  it('restores the manual daemon when service install takeover only reaches the same label through a different installed service target', async () => {
    await withTempDir('happier-service-install-takeover-wrong-target-', async (homeDir) => {
      let expectedServiceLabel = '';
      let installedPath = '';
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'darwin',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
        HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS: '200',
        HAPPIER_DAEMON_START_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '300',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '40',
      });
      vi.resetModules();
      doMockChildProcessSpawnSync((command: string, args: readonly string[] = []) => {
        if (command === 'launchctl' && args.includes('print')) {
          return { status: 0, stdout: Buffer.from('active'), stderr: Buffer.from('') };
        }
        writeFileSync(
          installedPath,
          buildLaunchdPlistXml({
            label: expectedServiceLabel,
            programArgs: ['/Users/other/.happier/cli/current/happier', 'daemon', 'start-sync'],
            env: {
              HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
              HAPPIER_PUBLIC_RELEASE_CHANNEL: 'stable',
            },
            workingDirectory: '/tmp',
            stdoutPath: `${homeDir}/other.out.log`,
            stderrPath: `${homeDir}/other.err.log`,
          }),
          'utf-8',
        );
        writeDaemonStateImpl?.({
          pid: process.pid,
          httpPort: 43131,
          startedAt: Date.now(),
          startedWithCliVersion: '0.0.0-service',
          startupSource: 'background-service',
          serviceLabel: expectedServiceLabel,
        });
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));
      vi.doMock('@/daemon/restartDaemonAndWait', () => ({
        restartDaemonAndWait: restartDaemonAndWaitMock,
      }));

      const controlClient = await import('@/daemon/controlClient');
      vi.spyOn(controlClient, 'stopDaemon').mockImplementation(stopDaemonMock);

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { writeDaemonState }, { configuration }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
        import('@/configuration'),
      ]);
      writeDaemonStateImpl = writeDaemonState;

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      expectedServiceLabel = paths.label;
      installedPath = paths.installedPath;
      mkdirSync(dirname(installedPath), { recursive: true });

      writeDaemonState({
        pid: process.pid,
        httpPort: 43132,
        startedAt: Date.now(),
        startedWithCliVersion: '0.0.0-manual',
        startupSource: 'manual',
        runtimeId: 'runtime-install-wrong-target',
      });

      await expect(runDaemonServiceCliCommand({ argv: ['install', '--takeover'] })).rejects.toThrow(/Failed to install|active daemon/i);
      expect(stopDaemonMock).toHaveBeenCalledTimes(1);
      expect(restartDaemonAndWaitMock).toHaveBeenCalledTimes(1);
    });
  });

  it('allows service install takeover when service ownership appears after the generic daemon start wait budget', async () => {
    await withTempDir('happier-service-install-takeover-delayed-owner-', async (homeDir) => {
      let expectedServiceLabel = '';
      let installedPath = '';
      let ownerWritten = false;
      const delayedOwnerWrites: Array<Promise<void>> = [];
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS: '50',
        HAPPIER_DAEMON_START_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '500',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      doMockChildProcessSpawnSync((command: string, args: readonly string[] = []) => {
        if (command === 'systemctl' && args.includes('is-active')) {
          return ownerWritten
            ? { status: 0, stdout: Buffer.from('active'), stderr: Buffer.from('') }
            : { status: 1, stdout: Buffer.from(''), stderr: Buffer.from('inactive') };
        }
        scheduleDelayedOwnerWriteOnce(delayedOwnerWrites, () => {
          if (!installedPath || !existsSync(installedPath)) return;
          const installedContents = readFileSync(installedPath, 'utf-8');
          writeFileSync(installedPath, installedContents, 'utf-8');
          writeDaemonStateImpl?.({
            pid: process.pid,
            httpPort: 43127,
            startedAt: Date.now(),
            startedWithCliVersion: configuration.currentCliVersion,
            startupSource: 'background-service',
            serviceLabel: expectedServiceLabel,
          });
          ownerWritten = true;
        });
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));
      vi.doMock('@/daemon/restartDaemonAndWait', () => ({
        restartDaemonAndWait: restartDaemonAndWaitMock,
      }));

      const controlClient = await import('@/daemon/controlClient');
      vi.spyOn(controlClient, 'stopDaemon').mockImplementation(stopDaemonMock);

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { writeDaemonState }, { configuration }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
        import('@/configuration'),
      ]);
      writeDaemonStateImpl = writeDaemonState;

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      expectedServiceLabel = paths.label;
      installedPath = paths.installedPath;
      mkdirSync(dirname(installedPath), { recursive: true });

      writeDaemonState({
        pid: process.pid,
        httpPort: 43128,
        startedAt: Date.now(),
        startedWithCliVersion: '0.0.0-manual',
        startupSource: 'manual',
        runtimeId: 'runtime-install-delayed-owner',
      });

      const output = captureStdoutJsonOutput<{
        ok: boolean;
        warning?: string;
      }>();
      try {
        await runDaemonServiceCliCommand({ argv: ['install', '--json', '--yes', '--takeover'] });
        const payload = output.json();
        expect(payload.ok).toBe(true);
        expect(stopDaemonMock).toHaveBeenCalledTimes(1);
        expect(restartDaemonAndWaitMock).not.toHaveBeenCalled();
      } finally {
        output.restore();
        await Promise.all(delayedOwnerWrites);
      }
    });
  });

  it('allows service install takeover for a non-cloud default-following service without legacy cloud cleanup', async () => {
    await withTempDir('happier-service-install-takeover-non-cloud-', async (homeDir) => {
      let expectedServiceLabel = '';
      let installedPath = '';
      let ownerWritten = false;
      const delayedOwnerWrites: Array<Promise<void>> = [];
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_INSTANCE_ID: 'company',
        HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS: '50',
        HAPPIER_DAEMON_START_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '500',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      doMockChildProcessSpawnSync((command: string, args: readonly string[] = []) => {
        if (command === 'systemctl' && args.includes('disable') && args.includes('happier-daemon.service')) {
          return { status: 1, stdout: Buffer.from(''), stderr: Buffer.from('legacy cleanup should not run') };
        }
        if (command === 'systemctl' && args.includes('is-active')) {
          return ownerWritten
            ? { status: 0, stdout: Buffer.from('active'), stderr: Buffer.from('') }
            : { status: 1, stdout: Buffer.from(''), stderr: Buffer.from('inactive') };
        }
        scheduleDelayedOwnerWriteOnce(delayedOwnerWrites, () => {
          if (!installedPath || !existsSync(installedPath)) return;
          const installedContents = readFileSync(installedPath, 'utf-8');
          writeFileSync(installedPath, installedContents, 'utf-8');
          writeDaemonStateImpl?.({
            pid: process.pid,
            httpPort: 43132,
            startedAt: Date.now(),
            startedWithCliVersion: configuration.currentCliVersion,
            startupSource: 'background-service',
            serviceLabel: expectedServiceLabel,
            runtimeId: 'runtime-install-non-cloud',
          });
          ownerWritten = true;
        });
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));
      vi.doMock('@/daemon/restartDaemonAndWait', () => ({
        restartDaemonAndWait: restartDaemonAndWaitMock,
      }));

      const controlClient = await import('@/daemon/controlClient');
      vi.spyOn(controlClient, 'stopDaemon').mockImplementation(stopDaemonMock);

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { writeDaemonState }, { configuration }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
        import('@/configuration'),
      ]);
      writeDaemonStateImpl = writeDaemonState;

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      expectedServiceLabel = paths.label;
      installedPath = paths.installedPath;
      mkdirSync(dirname(installedPath), { recursive: true });

      writeDaemonState({
        pid: process.pid,
        httpPort: 43133,
        startedAt: Date.now(),
        startedWithCliVersion: '0.0.0-manual',
        startupSource: 'manual',
        runtimeId: 'runtime-install-non-cloud-manual',
      });

      const output = captureStdoutJsonOutput<{
        ok: boolean;
      }>();
      try {
        await runDaemonServiceCliCommand({ argv: ['install', '--json', '--yes', '--takeover'] });
        const payload = output.json();
        expect(payload.ok).toBe(true);
        expect(stopDaemonMock).toHaveBeenCalledTimes(1);
        expect(restartDaemonAndWaitMock).not.toHaveBeenCalled();
      } finally {
        output.restore();
        await Promise.all(delayedOwnerWrites);
      }
    });
  });

  it('allows default-following service install takeover when legacy systemd cleanup targets a missing unit', async () => {
    await withTempDir('happier-service-install-takeover-missing-legacy-unit-', async (homeDir) => {
      let expectedServiceLabel = '';
      let installedPath = '';
      let ownerWritten = false;
      const delayedOwnerWrites: Array<Promise<void>> = [];
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS: '50',
        HAPPIER_DAEMON_START_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '500',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      doMockChildProcessSpawnSync((command: string, args: readonly string[] = []) => {
        if (command === 'systemctl' && args.includes('disable') && args.includes('happier-daemon.service')) {
          return {
            status: 1,
            stdout: Buffer.from(''),
            stderr: Buffer.from('Failed to disable unit: Unit file happier-daemon.service does not exist.'),
          };
        }
        if (command === 'systemctl' && args.includes('is-active')) {
          return ownerWritten
            ? { status: 0, stdout: Buffer.from('active'), stderr: Buffer.from('') }
            : { status: 1, stdout: Buffer.from(''), stderr: Buffer.from('inactive') };
        }
        if (command === 'systemctl' && args.includes('enable')) {
          scheduleDelayedOwnerWriteOnce(delayedOwnerWrites, () => {
            if (!installedPath || !existsSync(installedPath)) return;
            const installedContents = readFileSync(installedPath, 'utf-8');
            writeFileSync(installedPath, installedContents, 'utf-8');
            writeDaemonStateImpl?.({
              pid: process.pid,
              httpPort: 43134,
              startedAt: Date.now(),
              startedWithCliVersion: configuration.currentCliVersion,
              startupSource: 'background-service',
              serviceLabel: expectedServiceLabel,
              runtimeId: 'runtime-install-missing-legacy-unit',
            });
            ownerWritten = true;
          });
        }
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));
      vi.doMock('@/daemon/restartDaemonAndWait', () => ({
        restartDaemonAndWait: restartDaemonAndWaitMock,
      }));

      const controlClient = await import('@/daemon/controlClient');
      vi.spyOn(controlClient, 'stopDaemon').mockImplementation(stopDaemonMock);

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { writeDaemonState }, { configuration }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
        import('@/configuration'),
      ]);
      writeDaemonStateImpl = writeDaemonState;

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      expectedServiceLabel = paths.label;
      installedPath = paths.installedPath;
      mkdirSync(dirname(installedPath), { recursive: true });

      writeDaemonState({
        pid: process.pid,
        httpPort: 43135,
        startedAt: Date.now(),
        startedWithCliVersion: '0.0.0-manual',
        startupSource: 'manual',
        runtimeId: 'runtime-install-missing-legacy-unit-manual',
      });

      const output = captureStdoutJsonOutput<{
        ok: boolean;
      }>();
      try {
        await runDaemonServiceCliCommand({ argv: ['install', '--json', '--yes', '--takeover'] });
        const payload = output.json();
        expect(payload.ok).toBe(true);
        expect(stopDaemonMock).toHaveBeenCalledTimes(1);
        expect(restartDaemonAndWaitMock).not.toHaveBeenCalled();
      } finally {
        output.restore();
        await Promise.all(delayedOwnerWrites);
      }
    });
  });

  it('restarts an already-active linux background service so the current Happier home takes ownership', async () => {
    await withTempDir('happier-service-install-linux-restart-active-unit-', async (homeDir) => {
      let expectedServiceLabel = '';
      let installedPath = '';
      let currentCliVersion = '';
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;
      let restartObserved = false;
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:child_process')>();
        return {
          ...actual,
          spawnSync: vi.fn((command: string, args: readonly string[] = []) => {
            if (command === 'systemctl' && args.includes('is-active')) {
              return {
                status: restartObserved ? 0 : 1,
                stdout: Buffer.from(restartObserved ? 'active' : 'inactive'),
                stderr: Buffer.from(''),
              };
            }
            if (command === 'systemctl' && args.includes('restart')) {
              restartObserved = true;
              writeDaemonStateImpl?.({
                pid: process.pid,
                httpPort: 43133,
                startedAt: Date.now(),
                startedWithCliVersion: currentCliVersion,
                startedWithPublicReleaseChannel: 'stable',
                startupSource: 'background-service',
                serviceLabel: expectedServiceLabel,
              });
              return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
            }
            writeFileSync(
              installedPath,
              renderSystemdServiceUnit({
                description: 'Happier Daemon',
                execStart: ['/Users/tester/.happier/cli/current/happier', 'daemon', 'start-sync'],
                env: {
                  HAPPIER_DAEMON_STARTUP_SOURCE: 'background-service',
                  HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
                  HAPPIER_DAEMON_SERVICE_LABEL: expectedServiceLabel,
                  HAPPIER_PUBLIC_RELEASE_CHANNEL: 'stable',
                },
                wantedBy: 'default.target',
              }),
              'utf-8',
            );
            return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
          }),
        };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { writeDaemonState }, { configuration }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
        import('@/configuration'),
      ]);
      writeDaemonStateImpl = writeDaemonState;
      currentCliVersion = configuration.currentCliVersion;

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      expectedServiceLabel = paths.label;
      installedPath = paths.installedPath;
      mkdirSync(dirname(installedPath), { recursive: true });

      await expect(runDaemonServiceCliCommand({ argv: ['install', '--yes'] })).resolves.toBeUndefined();
      expect(restartObserved).toBe(true);
    });
  });

  it('treats an active wait-for-auth background service as a successful install when the current relay has no credentials', async () => {
    await withTempDir('happier-service-install-wait-for-auth-', async (homeDir) => {
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS: '50',
        HAPPIER_DAEMON_START_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:child_process')>();
        return {
          ...actual,
          spawnSync: vi.fn((command: string, args: readonly string[] = []) => {
            if (command === 'systemctl' && args.includes('disable') && args.includes('happier-daemon.service')) {
              return {
                status: 1,
                stdout: Buffer.from(''),
                stderr: Buffer.from('Failed to disable unit: Unit file happier-daemon.service does not exist.'),
              };
            }
            if (command === 'systemctl' && args.includes('is-active')) {
              return { status: 0, stdout: Buffer.from('active'), stderr: Buffer.from('') };
            }
            return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
          }),
        };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));

      const [{ runDaemonServiceCliCommand }, { clearDaemonStateForTests: clearDaemonState }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
      ]);
      clearDaemonState();

      const output = captureStdoutJsonOutput<{ ok: boolean; platform: string }>();
      try {
        await runDaemonServiceCliCommand({ argv: ['install', '--json', '--yes'] });
        const payload = output.json();
        expect(payload.ok).toBe(true);
        expect(payload.platform).toBe('linux');
      } finally {
        output.restore();
      }
    });
  });

  it('sets systemd user bus env when probing service health during install', async () => {
    await withTempDir('happier-service-install-systemd-env-', async (homeDir) => {
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS: '50',
        HAPPIER_DAEMON_START_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });

      const previousXdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
      const previousDbus = process.env.DBUS_SESSION_BUS_ADDRESS;
      delete process.env.XDG_RUNTIME_DIR;
      delete process.env.DBUS_SESSION_BUS_ADDRESS;

      vi.resetModules();
      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:child_process')>();
        return {
          ...actual,
          spawnSync: vi.fn((command: string, args: readonly string[] = [], options?: any) => {
            if (command === 'systemctl' && args.includes('is-active')) {
              const env = options?.env ?? {};
              if (!env.XDG_RUNTIME_DIR || !env.DBUS_SESSION_BUS_ADDRESS) {
                return { status: 1, stdout: Buffer.from(''), stderr: Buffer.from('Failed to connect to bus: No medium found') };
              }
              return { status: 0, stdout: Buffer.from('active'), stderr: Buffer.from('') };
            }
            return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
          }),
        };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));

      try {
        const [{ runDaemonServiceCliCommand }, { clearDaemonStateForTests: clearDaemonState }] = await Promise.all([
          loadCliModule(),
          import('@/persistence'),
        ]);
        clearDaemonState();

        const output = captureStdoutJsonOutput<{ ok: boolean; platform: string }>();
        try {
          await runDaemonServiceCliCommand({ argv: ['install', '--json', '--yes'] });
          const payload = output.json();
          expect(payload.ok).toBe(true);
          expect(payload.platform).toBe('linux');
        } finally {
          output.restore();
        }
      } finally {
        if (previousXdgRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
        else process.env.XDG_RUNTIME_DIR = previousXdgRuntimeDir;
        if (previousDbus === undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS;
        else process.env.DBUS_SESSION_BUS_ADDRESS = previousDbus;
      }
    });
  });

  it('allows darwin service install when the expected launchd owner runs from a packaged entrypoint', async () => {
    await withTempDir('happier-service-install-darwin-packaged-entrypoint-', async (homeDir) => {
      const happierHomeDir = `${homeDir}/.happier`;
      let expectedServiceLabel = '';
      let ownerWritten = false;
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'darwin',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      doMockChildProcessSpawnSync((command: string, args: readonly string[] = []) => {
        if (command !== 'launchctl') {
          return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
        }
        if (String(args[0] ?? '') === 'print') {
          return ownerWritten
            ? { status: 0, stdout: Buffer.from('state = running'), stderr: Buffer.from('') }
            : { status: 1, stdout: Buffer.from(''), stderr: Buffer.from('service not running') };
        }
        if (String(args[0] ?? '') === 'bootstrap' || String(args[0] ?? '') === 'kickstart') {
          ownerWritten = true;
          writeDaemonStateImpl?.({
            pid: process.pid,
            httpPort: 43135,
            startedAt: Date.now(),
            startedWithCliVersion: '0.0.0-packaged-entrypoint',
            startedWithPublicReleaseChannel: 'stable',
            startupSource: 'background-service',
            serviceLabel: expectedServiceLabel,
            runtimeId: 'runtime-packaged-entrypoint',
          });
        }
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { writeDaemonState }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
      ]);
      writeDaemonStateImpl = writeDaemonState;
      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      expectedServiceLabel = paths.label;

      const output = captureStdoutJsonOutput<{ ok: boolean; platform: string }>();
      try {
        await runDaemonServiceCliCommand({ argv: ['install', '--yes', '--json'] });
        const payload = output.json();
        expect(payload.ok).toBe(true);
        expect(payload.platform).toBe('darwin');
      } finally {
        output.restore();
      }
    });
  });

  it('restores the manual daemon when service install takeover only observes a transient healthy owner', async () => {
    await withTempDir('happier-service-install-takeover-transient-owner-', async (homeDir) => {
      let expectedServiceLabel = '';
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;
      let clearDaemonStateImpl: (() => void) | null = null;
      let healthChecks = 0;
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '40',
      });
      vi.resetModules();
      doMockChildProcessSpawnSync((command: string, args: readonly string[] = []) => {
        if (command === 'systemctl' && args.includes('is-active')) {
          healthChecks += 1;
          if (healthChecks === 1) {
            clearDaemonStateImpl?.();
            return { status: 0, stdout: Buffer.from('active'), stderr: Buffer.from('') };
          }
          return { status: 1, stdout: Buffer.from(''), stderr: Buffer.from('inactive') };
        }
        writeDaemonStateImpl?.({
          pid: process.pid,
          httpPort: 43129,
          startedAt: Date.now(),
          startedWithCliVersion: '0.0.0-service',
          startupSource: 'background-service',
          serviceLabel: expectedServiceLabel,
        });
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));
      vi.doMock('@/daemon/restartDaemonAndWait', () => ({
        restartDaemonAndWait: restartDaemonAndWaitMock,
      }));

      const controlClient = await import('@/daemon/controlClient');
      vi.spyOn(controlClient, 'stopDaemon').mockImplementation(stopDaemonMock);

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { writeDaemonState, clearDaemonStateForTests: clearDaemonState }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
      ]);
      writeDaemonStateImpl = writeDaemonState;
      clearDaemonStateImpl = clearDaemonState;

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      expectedServiceLabel = paths.label;

      writeDaemonState({
        pid: process.pid,
        httpPort: 43130,
        startedAt: Date.now(),
        startedWithCliVersion: '0.0.0-manual',
        startupSource: 'manual',
        runtimeId: 'runtime-install-transient-owner',
      });

      await expect(runDaemonServiceCliCommand({ argv: ['install', '--takeover'] })).rejects.toThrow(/did not become the active daemon/i);
      expect(stopDaemonMock).toHaveBeenCalledTimes(1);
      expect(restartDaemonAndWaitMock).toHaveBeenCalledTimes(1);
    });
  });

  it('treats -h as help (not as a subcommand)', async () => {
    const {
      runDaemonServiceCliCommand,
      resolveDaemonServiceCliRuntimeFromEnv,
      resolveDaemonServicePaths,
    } = await loadCliModule();
    envScope.patch({
      HAPPIER_DAEMON_SERVICE_PLATFORM: 'darwin',
      HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: '/tmp',
      HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: '/tmp/happier',
    });

    const stdout = captureStdout();
    const stderr = captureStderr();
    try {
      await runDaemonServiceCliCommand({ argv: ['-h'] });

      expect(stdout.text()).toContain('Usage:');
      expect(stderr.text()).not.toContain('Unknown daemon service subcommand');
    } finally {
      stderr.restore();
      stdout.restore();
    }
  });

  it('resolves the daemon service user home from the real OS user even when HOME is stack-isolated', async () => {
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return {
        ...actual,
        userInfo: vi.fn(() => ({ homedir: '/real-user-home' })),
        homedir: vi.fn(() => '/isolated-stack-home'),
      };
    });

    const { resolveDaemonServiceCliRuntimeFromEnv } = await loadCliModule();
    const runtime = resolveDaemonServiceCliRuntimeFromEnv({
      processEnv: {
        ...process.env,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'darwin',
        HOME: '/isolated-stack-home',
        USERPROFILE: '/isolated-stack-home',
      },
    });

    expect(runtime.userHomeDir).toBe('/real-user-home');
  });

  it('prefers the invoking sudo user home + happier home for user-scoped service operations run as root', async () => {
    envScope.patch({
      // Mirror typical `sudo` behavior where user env is not preserved unless explicitly requested.
      HAPPIER_HOME_DIR: '',
    });
    vi.resetModules();

    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return {
        ...actual,
        userInfo: vi.fn(() => ({ homedir: '/root' })),
        homedir: vi.fn(() => '/root'),
      };
    });
    vi.doMock('./resolveLinuxSystemUserPaths', async () => {
      const actual = await vi.importActual<typeof import('./resolveLinuxSystemUserPaths')>('./resolveLinuxSystemUserPaths');
      return {
        ...actual,
        resolveLinuxSystemUserPaths: vi.fn(() => ({
          userHomeDir: '/home/sudo-user',
          happierHomeDir: '/home/sudo-user/.happier',
        })),
      };
    });

    const { resolveDaemonServiceCliRuntimeFromEnv } = await loadCliModule();
    const runtime = resolveDaemonServiceCliRuntimeFromEnv({
      processEnv: {
        ...process.env,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_UID: '0',
        SUDO_USER: 'sudo-user',
        HOME: '/root',
      },
    });

    expect(runtime.userHomeDir).toBe('/home/sudo-user');
    expect(runtime.happierHomeDir).toBe('/home/sudo-user/.happier');
  });

  it('expands ~/ daemon service home overrides against the provided HOME', async () => {
    const { resolveDaemonServiceCliRuntimeFromEnv } = await loadCliModule();
    const runtime = resolveDaemonServiceCliRuntimeFromEnv({
      processEnv: {
        ...process.env,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'darwin',
        HOME: '/scoped/home',
        USERPROFILE: '/scoped/home',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: '~/service-home',
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: '~/service-happier',
      },
    });

    expect(runtime.userHomeDir).toBe('/scoped/home/service-home');
    expect(runtime.happierHomeDir).toBe('/scoped/home/service-happier');
  });

  it('fails closed when starting a background service while a manually started daemon is already running', async () => {
    await withTempDir('happier-service-start-owner-conflict-', async (homeDir) => {
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS: '200',
        HAPPIER_DAEMON_START_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '300',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '40',
      });
      vi.resetModules();

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { writeDaemonState }, { configuration }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
        import('@/configuration'),
      ]);

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      mkdirSync(dirname(paths.installedPath), { recursive: true });
      writeFileSync(
        paths.installedPath,
        renderSystemdServiceUnit({
          description: 'Happier Daemon',
          execStart: ['/Users/tester/.happier/cli/current/happier', 'daemon', 'start-sync'],
          env: {
            HAPPIER_DAEMON_STARTUP_SOURCE: 'background-service',
            HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
            HAPPIER_ACTIVE_SERVER_ID: 'cloud',
            HAPPIER_PUBLIC_RELEASE_CHANNEL: 'stable',
          },
          wantedBy: 'default.target',
        }),
        'utf-8',
      );

      writeDaemonState({
        pid: process.pid,
        httpPort: 43116,
        startedAt: Date.now(),
        startedWithCliVersion: '0.0.0-manual',
        startupSource: 'manual',
      });

      const output = captureStdoutJsonOutput<{
        ok: boolean;
        error: string;
        message: string;
      }>();
      try {
        await runDaemonServiceCliCommand({ argv: ['start', '--json'] });
        const payload = output.json();
        expect(payload.ok).toBe(false);
        expect(payload.error).toBe('owner_conflict');
        expect(payload.message).toContain('happier daemon stop');
        expect(payload.message).toContain('--takeover');
      } finally {
        output.restore();
      }
    });
  });

  it('treats an active wait-for-auth background service as a successful start when the current relay has no credentials', async () => {
    await withTempDir('happier-service-start-wait-for-auth-', async (homeDir) => {
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS: '50',
        HAPPIER_DAEMON_START_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:child_process')>();
        return {
          ...actual,
          spawnSync: vi.fn((command: string, args: readonly string[] = []) => {
            if (command === 'systemctl' && args.includes('is-active')) {
              return { status: 0, stdout: Buffer.from('active'), stderr: Buffer.from('') };
            }
            return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
          }),
        };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { clearDaemonStateForTests: clearDaemonState }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
      ]);
      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      mkdirSync(dirname(paths.installedPath), { recursive: true });
      writeValidInstalledDaemonServiceFile(paths.installedPath);
      clearDaemonState();

      const output = captureStdoutJsonOutput<{ ok: boolean; platform: string }>();
      try {
        await runDaemonServiceCliCommand({ argv: ['start', '--json'] });
        const payload = output.json();
        expect(payload.ok).toBe(true);
        expect(payload.platform).toBe('linux');
      } finally {
        output.restore();
      }
    });
  });

  it('allows service start when ownership appears after the initial post-auth convergence delay', async () => {
    await withTempDir('happier-service-start-delayed-owner-', async (homeDir) => {
      let ownerWritten = false;
      let expectedServiceLabel = '';
      let currentPublicReleaseChannel: 'stable' | 'preview' | 'dev' = 'stable';
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS: '50',
        HAPPIER_DAEMON_START_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_ACTIVE_GRACE_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:child_process')>();
        return {
          ...actual,
          spawnSync: vi.fn((command: string, args: readonly string[] = []) => {
            if (command === 'systemctl' && args.includes('is-active')) {
              return { status: 0, stdout: Buffer.from('active'), stderr: Buffer.from('') };
            }
            setTimeout(() => {
              writeDaemonStateImpl?.({
                pid: process.pid,
                httpPort: 43123,
                startedAt: Date.now(),
                startedWithCliVersion: configuration.currentCliVersion,
                startedWithPublicReleaseChannel: currentPublicReleaseChannel,
                startupSource: 'background-service',
                serviceLabel: expectedServiceLabel,
              });
              ownerWritten = true;
            }, 100);
            return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
          }),
        };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { clearDaemonStateForTests: clearDaemonState, writeCredentialsLegacy, writeDaemonState }, { configuration }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
        import('@/configuration'),
      ]);
      writeDaemonStateImpl = writeDaemonState;

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      currentPublicReleaseChannel = runtime.channel === 'publicdev' ? 'dev' : runtime.channel;
      const paths = resolveDaemonServicePaths(runtime);
      expectedServiceLabel = paths.label;
      mkdirSync(dirname(paths.installedPath), { recursive: true });
      writeValidInstalledDaemonServiceFile(paths.installedPath);
      await writeCredentialsLegacy({ secret: new Uint8Array(32).fill(1), token: 'token-delayed-owner' });
      clearDaemonState();

      const output = captureStdoutJsonOutput<{ ok: boolean; platform: string }>();
      try {
        await runDaemonServiceCliCommand({ argv: ['start', '--json'] });
        const payload = output.json();
        expect(payload.ok).toBe(true);
        expect(payload.platform).toBe('linux');
      } finally {
        output.restore();
      }
    });
  });

  it('restarts a drifted linux service on start so the running default-following service adopts the active relay', async () => {
    await withTempDir('happier-service-start-drifted-active-unit-', async (homeDir) => {
      const spawnedCommands: Array<{ command: string; args: readonly string[] }> = [];
      const happierHomeDir = `${homeDir}/.happier`;
      let expectedServiceLabel = '';
      let expectedCliVersion = '';
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;

      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
        HAPPIER_PUBLIC_RELEASE_CHANNEL: 'preview',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_ACTIVE_GRACE_TIMEOUT_MS: '0',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      doMockChildProcessSpawnSync((command: string, args: readonly string[] = []) => {
        spawnedCommands.push({ command, args });
        if (command === 'systemctl' && args.includes('restart')) {
          writeDaemonStateImpl?.({
            pid: process.pid,
            httpPort: 43137,
            startedAt: Date.now(),
            startedWithCliVersion: expectedCliVersion,
            startedWithPublicReleaseChannel: 'preview',
            startupSource: 'background-service',
            serviceLabel: expectedServiceLabel,
            runtimeId: 'runtime-drifted-active-unit',
          });
        }
        if (command === 'systemctl' && args.includes('is-active')) {
          return { status: 0, stdout: Buffer.from('active'), stderr: Buffer.from('') };
        }
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { clearDaemonStateForTests: clearDaemonState, writeCredentialsLegacy, writeDaemonState }, { configuration }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
        import('@/configuration'),
      ]);
      writeDaemonStateImpl = writeDaemonState;
      expectedCliVersion = configuration.currentCliVersion;

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      expectedServiceLabel = paths.label;
      mkdirSync(dirname(paths.installedPath), { recursive: true });
      writeValidInstalledDaemonServiceFile(paths.installedPath, {
        releaseChannel: 'stable',
        targetMode: 'default-following',
      });
      await writeCredentialsLegacy({ secret: new Uint8Array(32).fill(1), token: 'token-drifted-active-unit' });
      clearDaemonState();

      const output = captureStdoutJsonOutput<{ ok: boolean; platform: string }>();
      try {
        await runDaemonServiceCliCommand({ argv: ['start', '--json'] });
        const payload = output.json();
        expect(payload.ok).toBe(true);
        expect(payload.platform).toBe('linux');
        expect(spawnedCommands.some((entry) => entry.command === 'systemctl' && entry.args.includes('restart'))).toBe(true);
      } finally {
        output.restore();
      }
    });
  });

  it('restarts a running default-following service on start when it is not active for the selected relay', async () => {
    await withTempDir('happier-service-start-running-default-following-wrong-relay-', async (homeDir) => {
      const spawnedCommands: Array<{ command: string; args: readonly string[] }> = [];
      const happierHomeDir = `${homeDir}/.happier`;
      let expectedServiceLabel = '';
      let expectedCliVersion = '';
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;

      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
        HAPPIER_PUBLIC_RELEASE_CHANNEL: 'preview',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_ACTIVE_GRACE_TIMEOUT_MS: '0',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      doMockChildProcessSpawnSync((command: string, args: readonly string[] = []) => {
        spawnedCommands.push({ command, args });
        if (command === 'systemctl' && args.includes('restart')) {
          writeDaemonStateImpl?.({
            pid: process.pid,
            httpPort: 43138,
            startedAt: Date.now(),
            startedWithCliVersion: expectedCliVersion,
            startedWithPublicReleaseChannel: 'preview',
            startupSource: 'background-service',
            serviceLabel: expectedServiceLabel,
            runtimeId: 'runtime-default-following-restarted-for-active-relay',
          });
        }
        if (command === 'systemctl' && args.includes('is-active')) {
          return { status: 0, stdout: Buffer.from('active'), stderr: Buffer.from('') };
        }
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { clearDaemonStateForTests: clearDaemonState, writeCredentialsLegacy, writeDaemonState }, { configuration }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
        import('@/configuration'),
      ]);
      writeDaemonStateImpl = writeDaemonState;
      expectedCliVersion = configuration.currentCliVersion;

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      expectedServiceLabel = paths.label;
      mkdirSync(dirname(paths.installedPath), { recursive: true });
      const expectedPlan = planDaemonServiceInstall({
        platform: runtime.platform,
        mode: 'user',
        channel: runtime.channel,
        targetMode: runtime.targetMode,
        instanceId: runtime.instanceId,
        activeServerId: runtime.activeServerId,
        userHomeDir: runtime.userHomeDir,
        happierHomeDir: runtime.happierHomeDir,
        serverUrl: runtime.serverUrl,
        webappUrl: runtime.webappUrl,
        publicServerUrl: runtime.publicServerUrl,
        nodePath: runtime.nodePath,
        entryPath: runtime.entryPath,
      });
      writeFileSync(paths.installedPath, expectedPlan.files[0]?.content ?? '', 'utf-8');
      await writeCredentialsLegacy({ secret: new Uint8Array(32).fill(1), token: 'token-default-following-wrong-relay' });
      clearDaemonState();

      const output = captureStdoutJsonOutput<{ ok: boolean; platform: string }>();
      try {
        await runDaemonServiceCliCommand({ argv: ['start', '--json'] });
        const payload = output.json();
        expect(payload.ok).toBe(true);
        expect(payload.platform).toBe('linux');
        expect(spawnedCommands.some((entry) => entry.command === 'systemctl' && entry.args.includes('restart'))).toBe(true);
        expect(spawnedCommands.some((entry) => entry.command === 'systemctl' && entry.args.includes('start'))).toBe(false);
      } finally {
        output.restore();
      }
    });
  });

  it('allows darwin service start when the expected launchd owner runs from a packaged entrypoint', async () => {
    await withTempDir('happier-service-start-darwin-packaged-entrypoint-', async (homeDir) => {
      const happierHomeDir = `${homeDir}/.happier`;
      let expectedServiceLabel = '';
      let ownerWritten = false;
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'darwin',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      doMockChildProcessSpawnSync((command: string, args: readonly string[] = []) => {
        if (command !== 'launchctl') {
          return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
        }
        if (String(args[0] ?? '') === 'print') {
          return ownerWritten
            ? { status: 0, stdout: Buffer.from('state = running'), stderr: Buffer.from('') }
            : { status: 1, stdout: Buffer.from(''), stderr: Buffer.from('service not running') };
        }
        if (String(args[0] ?? '') === 'bootstrap' || String(args[0] ?? '') === 'kickstart') {
          ownerWritten = true;
          writeDaemonStateImpl?.({
            pid: process.pid,
            httpPort: 43136,
            startedAt: Date.now(),
            startedWithCliVersion: '0.0.0-packaged-entrypoint',
            startedWithPublicReleaseChannel: 'stable',
            startupSource: 'background-service',
            serviceLabel: expectedServiceLabel,
            runtimeId: 'runtime-start-packaged-entrypoint',
          });
        }
        return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { writeDaemonState }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
      ]);
      writeDaemonStateImpl = writeDaemonState;
      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      expectedServiceLabel = paths.label;
      mkdirSync(dirname(paths.installedPath), { recursive: true });
      const expectedInstallPlan = planDaemonServiceInstall({
        platform: runtime.platform,
        channel: runtime.channel,
        targetMode: runtime.targetMode,
        instanceId: runtime.instanceId,
        uid: runtime.uid ?? undefined,
        userHomeDir: runtime.userHomeDir,
        happierHomeDir: runtime.happierHomeDir,
        serverUrl: runtime.serverUrl,
        webappUrl: runtime.webappUrl,
        publicServerUrl: runtime.publicServerUrl,
        nodePath: runtime.nodePath,
        entryPath: runtime.entryPath,
      });
      writeFileSync(paths.installedPath, expectedInstallPlan.files[0]?.content ?? '', 'utf-8');

      const output = captureStdoutJsonOutput<{ ok: boolean; platform: string }>();
      try {
        await runDaemonServiceCliCommand({ argv: ['start', '--json'] });
        const payload = output.json();
        expect(payload.ok).toBe(true);
        expect(payload.platform).toBe('darwin');
      } finally {
        output.restore();
      }
    });
  });

  it('uses extended Windows ownership wait defaults for background-service restarts', async () => {
    await withTempDir('happier-service-restart-win32-wait-budget-', async (homeDir) => {
      const happierHomeDir = `${homeDir}/.happier`;
      const observedWaitTimeouts: number[] = [];
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'win32',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      doMockChildProcessSpawnSync(() => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') }));
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));
      vi.doMock('@/daemon/waitForDaemonRunningWithinBudget', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@/daemon/waitForDaemonRunningWithinBudget')>();
        return {
          ...actual,
          waitForDaemonRunningWithinBudget: vi.fn(async (params: { timeoutMs: number }) => {
            observedWaitTimeouts.push(params.timeoutMs);
            return false;
          }),
        };
      });

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { writeCredentialsLegacy }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
      ]);

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      mkdirSync(dirname(paths.installedPath), { recursive: true });
      writeValidInstalledWindowsDaemonServiceFile(paths.installedPath);
      await writeCredentialsLegacy({ secret: new Uint8Array(32).fill(1), token: 'token-win32-wait-budget' });

      await expect(runDaemonServiceCliCommand({ argv: ['restart', '--json'], commandPath: 'hdev service' })).rejects.toThrow(/hdev service status/i);
      expect(observedWaitTimeouts).toEqual([120_000, 60_000]);
    });
  });

  it('fails service restart when the background-service owner keeps the old release channel', async () => {
    await withTempDir('happier-service-restart-stale-owner-', async (homeDir) => {
      const happierHomeDir = `${homeDir}/.happier`;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'linux',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_START_WAIT_TIMEOUT_MS: '50',
        HAPPIER_DAEMON_START_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_ACTIVE_GRACE_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:child_process')>();
        return {
          ...actual,
          spawnSync: vi.fn((command: string, args: readonly string[] = []) => {
            if (command === 'systemctl' && args.includes('is-active')) {
              return { status: 0, stdout: Buffer.from('active'), stderr: Buffer.from('') };
            }
            return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
          }),
        };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }, { writeDaemonState }, { configuration }] = await Promise.all([
        loadCliModule(),
        import('@/persistence'),
        import('@/configuration'),
      ]);

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      mkdirSync(dirname(paths.installedPath), { recursive: true });
      writeValidInstalledDaemonServiceFile(paths.installedPath);

      writeDaemonState({
        pid: process.pid,
        httpPort: 43127,
        startedAt: Date.now(),
        startedWithCliVersion: configuration.currentCliVersion,
        startedWithPublicReleaseChannel: 'preview',
        startupSource: 'background-service',
        serviceLabel: paths.label,
      });

      await expect(runDaemonServiceCliCommand({ argv: ['restart', '--json'] })).rejects.toThrow(/did not become the active daemon/i);
    });
  });

  it('stops the current Windows service owner before reinstalling the same service label', async () => {
    await withTempDir('happier-service-install-win32-same-owner-', async (homeDir) => {
      const happierHomeDir = `${homeDir}/.happier`;
      const lifecycleEvents: string[] = [];
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'win32',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:child_process')>();
        return {
          ...actual,
          spawnSync: vi.fn((command: string, args: readonly string[] = []) => {
            if (command !== 'schtasks') {
              return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
            }
            const action = String(args[0] ?? '');
            lifecycleEvents.push(action);
            if (action === '/Run' && writeDaemonStateImpl) {
              writeDaemonStateImpl({
                pid: process.pid,
                httpPort: 43141,
                startedAt: Date.now(),
                startedWithCliVersion: configuration.currentCliVersion,
                startedWithPublicReleaseChannel: currentPublicReleaseChannel,
                startupSource: 'background-service',
                serviceLabel: paths.label,
                runtimeId: 'runtime-win32-install',
              });
            }
            if (action === '/Query') {
              return {
                status: 0,
                stdout: Buffer.from('Status: Running\nScheduled Task State: Enabled\n'),
                stderr: Buffer.from(''),
              };
            }
            return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
          }),
        };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));

      const controlClient = await import('@/daemon/controlClient');
      const [{ clearDaemonStateForTests: clearDaemonState, writeDaemonState }, { configuration }] = await Promise.all([
        import('@/persistence'),
        import('@/configuration'),
      ]);
      vi.spyOn(controlClient, 'stopDaemon').mockImplementation(async () => {
        lifecycleEvents.push('stopDaemon');
        await clearDaemonState();
      });

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }] = await Promise.all([
        loadCliModule(),
      ]);
      writeDaemonStateImpl = writeDaemonState;

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      const currentPublicReleaseChannel = runtime.channel === 'publicdev' ? 'dev' : runtime.channel;
      mkdirSync(dirname(paths.installedPath), { recursive: true });
      writeValidInstalledWindowsDaemonServiceFile(paths.installedPath);
      writeDaemonState({
        pid: process.pid,
        httpPort: 43140,
        startedAt: Date.now(),
        startedWithCliVersion: configuration.currentCliVersion,
        startedWithPublicReleaseChannel: currentPublicReleaseChannel,
        startupSource: 'background-service',
        serviceLabel: paths.label,
        runtimeId: 'runtime-win32-existing',
      });

      const output = captureStdoutJsonOutput<{ ok: boolean; platform: string }>();
      try {
        await runDaemonServiceCliCommand({ argv: ['install', '--yes', '--json'] });
        const payload = output.json();
        expect(payload.ok).toBe(true);
        expect(payload.platform).toBe('win32');
      } finally {
        output.restore();
      }

      const stopIndex = lifecycleEvents.indexOf('stopDaemon');
      const createIndex = lifecycleEvents.indexOf('/Create');
      const runIndex = lifecycleEvents.indexOf('/Run');
      expect(stopIndex).toBeGreaterThanOrEqual(0);
      expect(createIndex).toBeGreaterThan(stopIndex);
      expect(runIndex).toBeGreaterThan(createIndex);
    });
  });

  it('stops the current Windows service owner before restarting the same service label', async () => {
    await withTempDir('happier-service-restart-win32-same-owner-', async (homeDir) => {
      const happierHomeDir = `${homeDir}/.happier`;
      const lifecycleEvents: string[] = [];
      let writeDaemonStateImpl: ((state: DaemonLocallyPersistedState) => void) | null = null;
      envScope.patch({
        HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_DAEMON_SERVICE_PLATFORM: 'win32',
        HAPPIER_DAEMON_SERVICE_USER_HOME_DIR: homeDir,
        HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR: happierHomeDir,
        HAPPIER_PUBLIC_RELEASE_CHANNEL: 'preview',
        HAPPIER_DAEMON_SERVICE_CHANNEL: 'preview',
        HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_TIMEOUT_MS: '120',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_WAIT_POLL_MS: '10',
        HAPPIER_DAEMON_SERVICE_OWNERSHIP_STABLE_MS: '20',
      });
      vi.resetModules();
      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:child_process')>();
        return {
          ...actual,
          spawnSync: vi.fn((command: string, args: readonly string[] = []) => {
            if (command !== 'schtasks') {
              return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
            }
            const action = String(args[0] ?? '');
            lifecycleEvents.push(action);
            if (action === '/Run' && writeDaemonStateImpl) {
              writeDaemonStateImpl({
                pid: process.pid,
                httpPort: 43143,
                startedAt: Date.now(),
                startedWithCliVersion: configuration.currentCliVersion,
                startedWithPublicReleaseChannel: currentPublicReleaseChannel,
                startupSource: 'background-service',
                serviceLabel: paths.label,
                runtimeId: 'runtime-win32-restarted',
              });
            }
            if (action === '/Query') {
              return {
                status: 0,
                stdout: Buffer.from('Status: Running\nScheduled Task State: Enabled\n'),
                stderr: Buffer.from(''),
              };
            }
            return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
          }),
        };
      });
      vi.doMock('./commandExistsInPath', () => ({
        commandExistsInPath: vi.fn(() => true),
      }));

      const controlClient = await import('@/daemon/controlClient');
      const [{ clearDaemonStateForTests: clearDaemonState, writeDaemonState }, { configuration }] = await Promise.all([
        import('@/persistence'),
        import('@/configuration'),
      ]);
      vi.spyOn(controlClient, 'stopDaemon').mockImplementation(async () => {
        lifecycleEvents.push('stopDaemon');
        await clearDaemonState();
      });

      const [{ runDaemonServiceCliCommand, resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths }] = await Promise.all([
        loadCliModule(),
      ]);
      writeDaemonStateImpl = writeDaemonState;

      const runtime = resolveDaemonServiceCliRuntimeFromEnv({ targetMode: 'default-following' });
      const paths = resolveDaemonServicePaths(runtime);
      const currentPublicReleaseChannel = runtime.channel === 'publicdev' ? 'dev' : runtime.channel;
      mkdirSync(dirname(paths.installedPath), { recursive: true });
      writeValidInstalledWindowsDaemonServiceFile(paths.installedPath, { releaseChannel: 'preview' });
      writeDaemonState({
        pid: process.pid,
        httpPort: 43142,
        startedAt: Date.now(),
        startedWithCliVersion: configuration.currentCliVersion,
        startedWithPublicReleaseChannel: 'stable',
        startupSource: 'background-service',
        serviceLabel: paths.label,
        runtimeId: 'runtime-win32-stale-owner',
      });

      const output = captureStdoutJsonOutput<{ ok: boolean; platform: string }>();
      try {
        await runDaemonServiceCliCommand({ argv: ['restart', '--json'] });
        const payload = output.json();
        expect(payload.ok).toBe(true);
        expect(payload.platform).toBe('win32');
      } finally {
        output.restore();
      }

      const stopIndex = lifecycleEvents.indexOf('stopDaemon');
      const runIndex = lifecycleEvents.indexOf('/Run');
      expect(stopIndex).toBeGreaterThanOrEqual(0);
      expect(runIndex).toBeGreaterThan(stopIndex);
    });
  });

});
