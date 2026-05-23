import { mkdtemp, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { RpcHandlerManager } from '../rpc/RpcHandlerManager';
import { registerMachineTerminalRpcHandlers } from './rpcHandlers.terminal';
import { createTerminalPtySessionManager } from '@/daemon/terminalPty/terminalPtySessionManager';
import type { PtyProcess, PtyProvider, PtySpawnParams } from '@/integrations/pty/ptyProvider';

class FakePty implements PtyProcess {
  public readonly writes: string[] = [];
  write(data: string): void { this.writes.push(data); }
  resize(): void { }
  kill(): void { }
  onData(_listener: (data: string) => void): { dispose: () => void } { return { dispose: () => { } }; }
  onExit(_listener: (e: { exitCode: number; signal?: number | undefined }) => void): { dispose: () => void } {
    return { dispose: () => { } };
  }
}

class FakePtyProvider implements PtyProvider {
  public readonly spawned: PtySpawnParams[] = [];
  public readonly ptys: FakePty[] = [];

  spawn(params: PtySpawnParams): PtyProcess {
    this.spawned.push(params);
    const pty = new FakePty();
    this.ptys.push(pty);
    return pty;
  }
}

describe('registerMachineTerminalRpcHandlers', () => {
  it('fails closed when explicitly disabled', async () => {
    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => registered.set(method, handler),
    } as unknown as RpcHandlerManager;

    registerMachineTerminalRpcHandlers({
      rpcHandlerManager,
      deps: {
        env: { HAPPIER_DAEMON_TERMINAL_ENABLED: '0' },
        workingDirectory: process.cwd(),
      },
    });

    const ensure = registered.get(RPC_METHODS.DAEMON_TERMINAL_ENSURE);
    expect(ensure).toBeDefined();

    await expect(ensure!({ terminalKey: 'k', cols: 80, rows: 24 })).resolves.toEqual({
      ok: false,
      errorCode: 'terminal_disabled',
      error: 'terminal_disabled',
    });
  });

  it('spawns a PTY session by default when cwd is allowed', async () => {
    const suiteDir = await mkdtemp(join(tmpdir(), 'happier-terminal-'));
    const rootDir = join(suiteDir, 'root');
    const subDir = join(rootDir, 'subdir');
    await mkdir(rootDir, { recursive: true });
    await mkdir(subDir, { recursive: true });
    const realSubDir = await realpath(subDir);

    const provider = new FakePtyProvider();
    const sessionManager = createTerminalPtySessionManager({
      ptyProvider: provider,
      env: { SHELL: '/bin/bash' } as any,
      platform: 'linux',
      now: () => 0,
      config: {
        maxSessions: 10,
        idleTimeoutMs: 60_000,
        bufferMaxBytes: 1_000_000,
        bufferMaxEvents: 1000,
        urlParseBufferLimit: 32_768,
        maxWriteChunkBytes: 16_384,
        defaultCols: 80,
        defaultRows: 24,
      },
    });

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => registered.set(method, handler),
    } as unknown as RpcHandlerManager;

    registerMachineTerminalRpcHandlers({
      rpcHandlerManager,
      deps: {
        env: {},
        workingDirectory: rootDir,
        sessionManager,
      },
    });

    const ensure = registered.get(RPC_METHODS.DAEMON_TERMINAL_ENSURE);
    expect(ensure).toBeDefined();

    const result = await ensure!({ terminalKey: 'k', cwd: 'subdir', cols: 90, rows: 30 });
    expect(result).toEqual(expect.objectContaining({ ok: true, reused: false }));
    expect(provider.spawned).toHaveLength(1);
    expect(await realpath(provider.spawned[0]?.options.cwd ?? '')).toBe(realSubDir);
  });

  it('spawns a prepared profile auth session command with daemon-held env and initial input', async () => {
    const suiteDir = await mkdtemp(join(tmpdir(), 'happier-terminal-profile-auth-'));
    const profileDir = join(suiteDir, 'profile');
    await mkdir(profileDir, { recursive: true });

    const provider = new FakePtyProvider();
    const sessionManager = createTerminalPtySessionManager({
      ptyProvider: provider,
      env: { SHELL: '/bin/bash', CLAUDE_CONFIG_DIR: '/global' } as any,
      platform: 'linux',
      now: () => 0,
      config: {
        maxSessions: 10,
        idleTimeoutMs: 60_000,
        bufferMaxBytes: 1_000_000,
        bufferMaxEvents: 1000,
        urlParseBufferLimit: 32_768,
        maxWriteChunkBytes: 16_384,
        defaultCols: 80,
        defaultRows: 24,
      },
    });

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => registered.set(method, handler),
    } as unknown as RpcHandlerManager;

    registerMachineTerminalRpcHandlers({
      rpcHandlerManager,
      deps: {
        env: { HAPPIER_DAEMON_TERMINAL_ENABLED: '1', SHELL: '/bin/bash', CLAUDE_CONFIG_DIR: '/global' },
        workingDirectory: suiteDir,
        sessionManager,
        profileAuthSessions: {
          get: (id: string) => id === 'auth-1'
            ? {
              profileAuthSessionId: 'auth-1',
	              providerId: 'claude',
	              profileId: 'work',
	              profileDir,
	              terminalKey: 'profile-login:machine-a:claude:work',
	              command: '/bin/claude',
              args: ['--dangerously-skip-permissions'],
              env: { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: profileDir },
	              initialInput: '/login\r',
	              cwd: profileDir,
	              expiresAtMs: Number.MAX_SAFE_INTEGER,
	            }
            : null,
        },
      },
    });

    const ensure = registered.get(RPC_METHODS.DAEMON_TERMINAL_ENSURE);
    expect(ensure).toBeDefined();

    const result = await ensure!({
      terminalKey: 'profile-login:machine-a:claude:work',
      profileAuthSessionId: 'auth-1',
      cwd: '/should/not/be/used',
      initialCommand: 'echo unsafe',
      cols: 100,
      rows: 40,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, reused: false }));
    expect(provider.spawned).toHaveLength(1);
    expect(provider.spawned[0]).toEqual(expect.objectContaining({
      file: '/bin/claude',
      args: ['--dangerously-skip-permissions'],
    }));
    expect(provider.spawned[0]?.options.cwd).toBe(profileDir);
    expect(provider.spawned[0]?.options.env).toEqual(expect.objectContaining({
      CLAUDE_CONFIG_DIR: profileDir,
      PATH: '/usr/bin',
    }));
    expect(provider.spawned[0]?.options.env).not.toMatchObject({ CLAUDE_CONFIG_DIR: '/global' });
    expect(provider.ptys[0]?.writes).toEqual(['/login\r']);
  });

  it('rejects unknown profile auth session ids before spawning a terminal', async () => {
    const provider = new FakePtyProvider();
    const sessionManager = createTerminalPtySessionManager({
      ptyProvider: provider,
      env: { SHELL: '/bin/bash' } as any,
      platform: 'linux',
      now: () => 0,
      config: {
        maxSessions: 10,
        idleTimeoutMs: 60_000,
        bufferMaxBytes: 1_000_000,
        bufferMaxEvents: 1000,
        urlParseBufferLimit: 32_768,
        maxWriteChunkBytes: 16_384,
        defaultCols: 80,
        defaultRows: 24,
      },
    });
    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => registered.set(method, handler),
    } as unknown as RpcHandlerManager;

    registerMachineTerminalRpcHandlers({
      rpcHandlerManager,
      deps: {
        env: { HAPPIER_DAEMON_TERMINAL_ENABLED: '1' },
        workingDirectory: process.cwd(),
        sessionManager,
        profileAuthSessions: { get: () => null },
      },
    });

    await expect(registered.get(RPC_METHODS.DAEMON_TERMINAL_ENSURE)?.({
      terminalKey: 'profile-login:machine-a:claude:work',
      profileAuthSessionId: 'missing',
      cols: 80,
      rows: 24,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'terminal_invalid_request',
      error: 'terminal_invalid_request',
    });
    expect(provider.spawned).toHaveLength(0);
  });

  it('rejects profile auth sessions bound to a different terminal key', async () => {
    const suiteDir = await mkdtemp(join(tmpdir(), 'happier-terminal-profile-auth-key-'));
    const profileDir = join(suiteDir, 'profile');
    await mkdir(profileDir, { recursive: true });

    const provider = new FakePtyProvider();
    const sessionManager = createTerminalPtySessionManager({
      ptyProvider: provider,
      env: { SHELL: '/bin/bash' } as any,
      platform: 'linux',
      now: () => 0,
      config: {
        maxSessions: 10,
        idleTimeoutMs: 60_000,
        bufferMaxBytes: 1_000_000,
        bufferMaxEvents: 1000,
        urlParseBufferLimit: 32_768,
        maxWriteChunkBytes: 16_384,
        defaultCols: 80,
        defaultRows: 24,
      },
    });
    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => registered.set(method, handler),
    } as unknown as RpcHandlerManager;

    registerMachineTerminalRpcHandlers({
      rpcHandlerManager,
      deps: {
        env: { HAPPIER_DAEMON_TERMINAL_ENABLED: '1' },
        workingDirectory: suiteDir,
        sessionManager,
        profileAuthSessions: {
          get: () => ({
            profileAuthSessionId: 'auth-1',
            providerId: 'claude',
            profileId: 'work',
            profileDir,
            terminalKey: 'profile-login:machine-a:claude:work',
            command: '/bin/claude',
            args: [],
            env: { CLAUDE_CONFIG_DIR: profileDir },
            expiresAtMs: Number.MAX_SAFE_INTEGER,
          }),
        },
      },
    });

    await expect(registered.get(RPC_METHODS.DAEMON_TERMINAL_ENSURE)?.({
      terminalKey: 'profile-login:machine-b:claude:work',
      profileAuthSessionId: 'auth-1',
      cols: 80,
      rows: 24,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'terminal_invalid_request',
      error: 'terminal_invalid_request',
    });
    expect(provider.spawned).toHaveLength(0);
  });

  it('allows an absolute cwd outside the default directory when no restricted policy is configured', async () => {
    const suiteDir = await mkdtemp(join(tmpdir(), 'happier-terminal-'));
    const defaultDir = join(suiteDir, 'default');
    const externalDir = join(suiteDir, 'external');
    await mkdir(defaultDir, { recursive: true });
    await mkdir(externalDir, { recursive: true });
    const realExternalDir = await realpath(externalDir);

    const provider = new FakePtyProvider();
    const sessionManager = createTerminalPtySessionManager({
      ptyProvider: provider,
      env: { SHELL: '/bin/bash' } as any,
      platform: 'linux',
      now: () => 0,
      config: {
        maxSessions: 10,
        idleTimeoutMs: 60_000,
        bufferMaxBytes: 1_000_000,
        bufferMaxEvents: 1000,
        urlParseBufferLimit: 32_768,
        maxWriteChunkBytes: 16_384,
        defaultCols: 80,
        defaultRows: 24,
      },
    });

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => registered.set(method, handler),
    } as unknown as RpcHandlerManager;

    registerMachineTerminalRpcHandlers({
      rpcHandlerManager,
      deps: {
        env: { HAPPIER_DAEMON_TERMINAL_ENABLED: '1' },
        workingDirectory: defaultDir,
        sessionManager,
      },
    });

    const ensure = registered.get(RPC_METHODS.DAEMON_TERMINAL_ENSURE);
    expect(ensure).toBeDefined();

    const result = await ensure!({ terminalKey: 'k', cwd: externalDir, cols: 80, rows: 24 });
    expect(result).toEqual(expect.objectContaining({ ok: true, reused: false }));
    expect(provider.spawned).toHaveLength(1);
    expect(await realpath(provider.spawned[0]?.options.cwd ?? '')).toBe(realExternalDir);
  });

  it('rejects an absolute cwd outside every restricted root', async () => {
    const suiteDir = await mkdtemp(join(tmpdir(), 'happier-terminal-'));
    const defaultDir = join(suiteDir, 'default');
    const restrictedRoot = join(suiteDir, 'allowed');
    const outsideDir = join(suiteDir, 'outside');
    await mkdir(defaultDir, { recursive: true });
    await mkdir(restrictedRoot, { recursive: true });
    await mkdir(outsideDir, { recursive: true });

    const provider = new FakePtyProvider();
    const sessionManager = createTerminalPtySessionManager({
      ptyProvider: provider,
      env: { SHELL: '/bin/bash' } as any,
      platform: 'linux',
      now: () => 0,
      config: {
        maxSessions: 10,
        idleTimeoutMs: 60_000,
        bufferMaxBytes: 1_000_000,
        bufferMaxEvents: 1000,
        urlParseBufferLimit: 32_768,
        maxWriteChunkBytes: 16_384,
        defaultCols: 80,
        defaultRows: 24,
      },
    });

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => registered.set(method, handler),
    } as unknown as RpcHandlerManager;

    registerMachineTerminalRpcHandlers({
      rpcHandlerManager,
      deps: {
        env: { HAPPIER_DAEMON_TERMINAL_ENABLED: '1' },
        workingDirectory: defaultDir,
        accessPolicy: {
          kind: 'restrictedRoots',
          roots: [restrictedRoot],
        },
        sessionManager,
      },
    });

    const ensure = registered.get(RPC_METHODS.DAEMON_TERMINAL_ENSURE);
    expect(ensure).toBeDefined();

    await expect(ensure!({ terminalKey: 'k', cwd: outsideDir, cols: 80, rows: 24 })).resolves.toEqual({
      ok: false,
      errorCode: 'terminal_cwd_denied',
      error: 'terminal_cwd_denied',
    });
    expect(provider.spawned).toHaveLength(0);
  });

  it('uses comma-delimited HAPPIER_MACHINE_RPC_WORKING_DIRECTORY as restricted roots', async () => {
    const suiteDir = await mkdtemp(join(tmpdir(), 'happier-terminal-'));
    const rootA = join(suiteDir, 'allowed-a');
    const rootB = join(suiteDir, 'allowed-b');
    const outsideDir = join(suiteDir, 'outside');
    await mkdir(rootA, { recursive: true });
    await mkdir(rootB, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    const realRootB = await realpath(rootB);

    const provider = new FakePtyProvider();
    const sessionManager = createTerminalPtySessionManager({
      ptyProvider: provider,
      env: { SHELL: '/bin/bash' } as any,
      platform: 'linux',
      now: () => 0,
      config: {
        maxSessions: 10,
        idleTimeoutMs: 60_000,
        bufferMaxBytes: 1_000_000,
        bufferMaxEvents: 1000,
        urlParseBufferLimit: 32_768,
        maxWriteChunkBytes: 16_384,
        defaultCols: 80,
        defaultRows: 24,
      },
    });

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => registered.set(method, handler),
    } as unknown as RpcHandlerManager;

    registerMachineTerminalRpcHandlers({
      rpcHandlerManager,
      deps: {
        env: {
          HAPPIER_DAEMON_TERMINAL_ENABLED: '1',
          HAPPIER_MACHINE_RPC_WORKING_DIRECTORY: `${rootA}, ${rootB}`,
        },
        sessionManager,
      },
    });

    const ensure = registered.get(RPC_METHODS.DAEMON_TERMINAL_ENSURE);
    expect(ensure).toBeDefined();

    await expect(ensure!({ terminalKey: 'outside', cwd: outsideDir, cols: 80, rows: 24 })).resolves.toEqual({
      ok: false,
      errorCode: 'terminal_cwd_denied',
      error: 'terminal_cwd_denied',
    });

    const result = await ensure!({ terminalKey: 'allowed', cwd: rootB, cols: 80, rows: 24 });
    expect(result).toEqual(expect.objectContaining({ ok: true, reused: false }));
    expect(provider.spawned).toHaveLength(1);
    expect(await realpath(provider.spawned[0]?.options.cwd ?? '')).toBe(realRootB);
  });

  it('rejects cwd outside the configured restricted root', async () => {
    const suiteDir = await mkdtemp(join(tmpdir(), 'happier-terminal-'));
    const rootDir = join(suiteDir, 'root');
    await mkdir(rootDir, { recursive: true });

    const provider = new FakePtyProvider();
    const sessionManager = createTerminalPtySessionManager({
      ptyProvider: provider,
      env: { SHELL: '/bin/bash' } as any,
      platform: 'linux',
      now: () => 0,
      config: {
        maxSessions: 10,
        idleTimeoutMs: 60_000,
        bufferMaxBytes: 1_000_000,
        bufferMaxEvents: 1000,
        urlParseBufferLimit: 32_768,
        maxWriteChunkBytes: 16_384,
        defaultCols: 80,
        defaultRows: 24,
      },
    });

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => registered.set(method, handler),
    } as unknown as RpcHandlerManager;

    registerMachineTerminalRpcHandlers({
      rpcHandlerManager,
      deps: {
        env: { HAPPIER_DAEMON_TERMINAL_ENABLED: '1' },
        workingDirectory: rootDir,
        accessPolicy: {
          kind: 'restrictedRoots',
          roots: [rootDir],
        },
        sessionManager,
      },
    });

    const ensure = registered.get(RPC_METHODS.DAEMON_TERMINAL_ENSURE);
    expect(ensure).toBeDefined();

    await expect(ensure!({ terminalKey: 'k', cwd: '/etc', cols: 80, rows: 24 })).resolves.toEqual({
      ok: false,
      errorCode: 'terminal_cwd_denied',
      error: 'terminal_cwd_denied',
    });
  });

  it('expands ~/ cwd against env HOME before validating terminal sessions', async () => {
    const suiteDir = await mkdtemp(join(tmpdir(), 'happier-terminal-home-'));
    const homeDir = join(suiteDir, 'home');
    const rootDir = join(homeDir, 'workspace');
    await mkdir(rootDir, { recursive: true });

    const provider = new FakePtyProvider();
    const sessionManager = createTerminalPtySessionManager({
      ptyProvider: provider,
      env: { SHELL: '/bin/bash' } as any,
      platform: 'linux',
      now: () => 0,
      config: {
        maxSessions: 10,
        idleTimeoutMs: 60_000,
        bufferMaxBytes: 1_000_000,
        bufferMaxEvents: 1000,
        urlParseBufferLimit: 32_768,
        maxWriteChunkBytes: 16_384,
        defaultCols: 80,
        defaultRows: 24,
      },
    });

    const registered = new Map<string, (params: any) => Promise<any>>();
    const rpcHandlerManager = {
      registerHandler: (method: string, handler: (params: any) => Promise<any>) => registered.set(method, handler),
    } as unknown as RpcHandlerManager;

    registerMachineTerminalRpcHandlers({
      rpcHandlerManager,
      deps: {
        env: { HOME: homeDir, HAPPIER_DAEMON_TERMINAL_ENABLED: '1' },
        workingDirectory: rootDir,
        sessionManager,
      },
    });

    const ensure = registered.get(RPC_METHODS.DAEMON_TERMINAL_ENSURE);
    expect(ensure).toBeDefined();

    const result = await ensure!({ terminalKey: 'k', cwd: '~/workspace', cols: 80, rows: 24 });
    expect(result).toEqual(expect.objectContaining({ ok: true, reused: false }));
    expect(provider.spawned).toHaveLength(1);
    expect(await realpath(provider.spawned[0]?.options.cwd ?? '')).toBe(await realpath(rootDir));
  });
});
