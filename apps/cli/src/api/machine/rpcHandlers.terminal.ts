import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import {
  DaemonTerminalCloseRequestSchema,
  DaemonTerminalEnsureRequestSchema,
  DaemonTerminalInputRequestSchema,
  DaemonTerminalResizeRequestSchema,
  DaemonTerminalRestartRequestSchema,
  DaemonTerminalStreamReadRequestSchema,
  type DaemonTerminalErrorCode,
} from '@happier-dev/protocol';
import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';

import type { RpcHandlerManager } from '../rpc/RpcHandlerManager';
import {
  authorizeFilesystemPath,
} from '@/rpc/handlers/fileSystem/accessPolicy/filesystemPathAuthorization';
import {
  type FilesystemAccessPolicy,
  resolveFilesystemPolicyDefaultDirectory,
  resolveFilesystemAccessPolicy,
} from '@/rpc/handlers/fileSystem/accessPolicy/filesystemAccessPolicy';
import { resolveMachineRpcWorkingDirectory } from './resolveMachineRpcWorkingDirectory';
import { readDaemonTerminalPtyConfig } from '@/daemon/terminalPty/terminalPtyConfig';
import { createTerminalPtySessionManager, type TerminalPtySessionManager } from '@/daemon/terminalPty/terminalPtySessionManager';
import { createNodePtyProvider } from '@/daemon/terminalPty/ptyProvider';
import { profileAuthSessions, type ProfileAuthSessionStore } from '@/auth/provision/profileAuthSessionStore';

function err(errorCode: DaemonTerminalErrorCode): { ok: false; errorCode: DaemonTerminalErrorCode; error: DaemonTerminalErrorCode } {
  return { ok: false, errorCode, error: errorCode };
}

export function registerMachineTerminalRpcHandlers(params: Readonly<{
  rpcHandlerManager: RpcHandlerManager;
  deps?: Readonly<{
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    workingDirectory?: string;
    accessPolicy?: FilesystemAccessPolicy;
    sessionManager?: TerminalPtySessionManager;
    profileAuthSessions?: Pick<ProfileAuthSessionStore, 'get'>;
  }>;
}>): void {
  const { rpcHandlerManager } = params;
  const env = params.deps?.env ?? process.env;
  const platform = params.deps?.platform ?? process.platform;
  const profileAuthSessionStore = params.deps?.profileAuthSessions ?? profileAuthSessions;

  const config = readDaemonTerminalPtyConfig(env);
  const accessPolicy = params.deps?.accessPolicy ?? resolveFilesystemAccessPolicy({ env, platform });
  const workingDirectory =
    params.deps?.workingDirectory
    ?? resolveFilesystemPolicyDefaultDirectory({
      defaultDirectory: resolveMachineRpcWorkingDirectory({ env, platform }),
      accessPolicy,
    });

  let sessionManager: TerminalPtySessionManager | null = params.deps?.sessionManager ?? null;
  const getSessionManager = (): TerminalPtySessionManager => {
    if (sessionManager) return sessionManager;
    sessionManager = createTerminalPtySessionManager({
      ptyProvider: createNodePtyProvider(),
      config: config.sessionManager,
      env,
      platform,
    });
    return sessionManager;
  };

  const resolveCwd = (cwdInput: unknown): { ok: true; cwd: string } | ReturnType<typeof err> => {
    const raw = typeof cwdInput === 'string' && cwdInput.trim().length > 0 ? cwdInput.trim() : workingDirectory;
    const expanded = expandHomeDirPath(raw, env, platform);

    const validation = authorizeFilesystemPath({
      targetPath: expanded,
      defaultDirectory: workingDirectory,
      accessPolicy,
      platform,
    });
    if (!validation.valid) {
      return err('terminal_cwd_denied');
    }
    return { ok: true, cwd: validation.resolvedPath };
  };

  const resolveProfileAuthLaunch = (
    profileAuthSessionId: string | undefined,
    terminalKey: string,
  ): {
    ok: true;
    launch: NonNullable<Parameters<TerminalPtySessionManager['ensure']>[0]['launch']>;
    cwd: string;
  } | ReturnType<typeof err> | null => {
    if (!profileAuthSessionId) return null;
    const session = profileAuthSessionStore.get(profileAuthSessionId);
    if (!session) return err('terminal_invalid_request');
    if (session.terminalKey !== terminalKey) {
      return err('terminal_invalid_request');
    }
    return {
      ok: true,
      cwd: session.cwd ?? session.profileDir,
      launch: {
        file: session.command,
        args: session.args,
        cwd: session.cwd ?? session.profileDir,
        env: session.env,
        ...(session.initialInput != null ? { initialInput: session.initialInput } : {}),
      },
    };
  };

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_TERMINAL_ENSURE, async (raw: unknown) => {
    if (!config.enabled) return err('terminal_disabled');
    const parsed = DaemonTerminalEnsureRequestSchema.safeParse(raw);
    if (!parsed.success) return err('terminal_invalid_request');

    const profileAuthLaunch = resolveProfileAuthLaunch(parsed.data.profileAuthSessionId, parsed.data.terminalKey);
    if (profileAuthLaunch && !profileAuthLaunch.ok) return profileAuthLaunch;

    const cwd = profileAuthLaunch
      ? { ok: true as const, cwd: profileAuthLaunch.cwd }
      : resolveCwd(parsed.data.cwd);
    if (!cwd.ok) return cwd;

    return getSessionManager().ensure({
      terminalKey: parsed.data.terminalKey,
      cwd: cwd.cwd,
      cols: parsed.data.cols,
      rows: parsed.data.rows,
      ...(profileAuthLaunch ? {} : { initialCommand: parsed.data.initialCommand }),
      ...(profileAuthLaunch ? { launch: profileAuthLaunch.launch } : {}),
    });
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_TERMINAL_STREAM_READ, async (raw: unknown) => {
    if (!config.enabled) return err('terminal_disabled');
    const parsed = DaemonTerminalStreamReadRequestSchema.safeParse(raw);
    if (!parsed.success) return err('terminal_invalid_request');

    return getSessionManager().read({
      terminalId: parsed.data.terminalId,
      cursor: parsed.data.cursor,
      maxBytes: parsed.data.maxBytes ?? config.readDefaults.maxBytes,
      maxEvents: parsed.data.maxEvents ?? config.readDefaults.maxEvents,
    });
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_TERMINAL_INPUT, async (raw: unknown) => {
    if (!config.enabled) return err('terminal_disabled');
    const parsed = DaemonTerminalInputRequestSchema.safeParse(raw);
    if (!parsed.success) return err('terminal_invalid_request');
    return getSessionManager().input(parsed.data);
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_TERMINAL_RESIZE, async (raw: unknown) => {
    if (!config.enabled) return err('terminal_disabled');
    const parsed = DaemonTerminalResizeRequestSchema.safeParse(raw);
    if (!parsed.success) return err('terminal_invalid_request');
    return getSessionManager().resize(parsed.data);
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_TERMINAL_CLOSE, async (raw: unknown) => {
    if (!config.enabled) return err('terminal_disabled');
    const parsed = DaemonTerminalCloseRequestSchema.safeParse(raw);
    if (!parsed.success) return err('terminal_invalid_request');
    return getSessionManager().close(parsed.data);
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_TERMINAL_RESTART, async (raw: unknown) => {
    if (!config.enabled) return err('terminal_disabled');
    const parsed = DaemonTerminalRestartRequestSchema.safeParse(raw);
    if (!parsed.success) return err('terminal_invalid_request');

    const profileAuthLaunch = resolveProfileAuthLaunch(parsed.data.profileAuthSessionId, parsed.data.terminalKey);
    if (profileAuthLaunch && !profileAuthLaunch.ok) return profileAuthLaunch;

    const cwd = profileAuthLaunch
      ? { ok: true as const, cwd: profileAuthLaunch.cwd }
      : resolveCwd(parsed.data.cwd);
    if (!cwd.ok) return cwd;

    return getSessionManager().restart({
      terminalKey: parsed.data.terminalKey,
      cwd: cwd.cwd,
      cols: parsed.data.cols,
      rows: parsed.data.rows,
      ...(profileAuthLaunch ? {} : { initialCommand: parsed.data.initialCommand }),
      ...(profileAuthLaunch ? { launch: profileAuthLaunch.launch } : {}),
    });
  });
}
