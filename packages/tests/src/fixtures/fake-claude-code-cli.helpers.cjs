const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

function safeAppendJsonl(filePath, obj) {
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, 'utf8');
  } catch {
    // Best-effort diagnostics only.
  }
}

function parseMcpConfigs(argv) {
  const configs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--mcp-config') continue;
    const raw = argv[i + 1];
    if (typeof raw !== 'string') continue;
    i++;
    try {
      const parsed = JSON.parse(raw);
      configs.push(parsed);
    } catch {
      configs.push({ _parseError: true, raw });
    }
  }
  return configs;
}

function mergeMcpServers(configs) {
  const merged = {};
  for (const cfg of configs) {
    if (!cfg || typeof cfg !== 'object') continue;
    const servers = cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : null;
    if (!servers) continue;
    for (const [name, value] of Object.entries(servers)) {
      merged[name] = value;
    }
  }
  return merged;
}

async function callMcpServerTool(params) {
  const { serverConfig, toolName, toolArgs, logPath, invocationId } = params;
  if (!serverConfig || typeof serverConfig !== 'object') {
    safeAppendJsonl(logPath, {
      type: 'mcp_tool_call_failed',
      invocationId,
      ts: Date.now(),
      toolName,
      message: 'Missing MCP server config',
    });
    throw new Error('Missing MCP server config');
  }
  const command = typeof serverConfig.command === 'string' ? serverConfig.command.trim() : '';
  if (!command) {
    safeAppendJsonl(logPath, {
      type: 'mcp_tool_call_failed',
      invocationId,
      ts: Date.now(),
      toolName,
      message: 'Missing MCP server command',
    });
    throw new Error('Missing MCP server command');
  }
  const args = Array.isArray(serverConfig.args) ? serverConfig.args.map((arg) => String(arg)) : [];
  const rootDir = path.resolve(__dirname, '../../../..');
  const sdkClientIndexPath = path.join(rootDir, 'apps/cli/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
  const sdkClientStdioPath = path.join(rootDir, 'apps/cli/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
  const { Client } = await import(pathToFileURL(sdkClientIndexPath).href);
  const { StdioClientTransport } = await import(pathToFileURL(sdkClientStdioPath).href);
  const env = {
    ...process.env,
    ...(serverConfig.env && typeof serverConfig.env === 'object' ? serverConfig.env : {}),
  };

  const transport = new StdioClientTransport({
    command,
    args,
    env,
    stderr: 'pipe',
  });
  const stderrLines = [];
  transport.stderr?.on?.('data', (chunk) => {
    stderrLines.push(Buffer.from(chunk).toString('utf8'));
  });

  const client = new Client({ name: 'fake-claude-e2e', version: '0.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    safeAppendJsonl(logPath, {
      type: 'mcp_tool_call_started',
      invocationId,
      ts: Date.now(),
      toolName,
    });
    const result = await client.callTool({ name: toolName, arguments: toolArgs });
    safeAppendJsonl(logPath, {
      type: 'mcp_tool_call_completed',
      invocationId,
      ts: Date.now(),
      toolName,
      isError: Boolean(result?.isError),
    });
    return result;
  } catch (error) {
    safeAppendJsonl(logPath, {
      type: 'mcp_tool_call_failed',
      invocationId,
      ts: Date.now(),
      toolName,
      message: error instanceof Error ? error.message : String(error),
      stderrTail: stderrLines.join('').slice(-2000),
    });
    throw error;
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

function findArgValue(argv, name) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) {
      const value = argv[i + 1];
      if (typeof value === 'string') return value;
      return null;
    }
  }
  return null;
}

function parseHookCommandString(cmd) {
  if (typeof cmd !== 'string' || cmd.length === 0) return null;
  // Expected: node "<forwarderScript>" <port> ["HookEventName"] [--secret-file "<path>"]
  // or: "<runtimeExecutable>" "<forwarderScript>" <port> ["HookEventName"] [--secret-file "<path>"]
  const m = cmd.match(/^(node|"([^"]+)")\s+"([^"]+)"\s+(\d+)(?:\s+"([^"]+)")?(?:\s+--secret-file\s+"([^"]+)")?\s*$/);
  if (!m) return { type: 'raw', command: cmd };
  return {
    type: 'node',
    runtimeExecutable: typeof m[2] === 'string' && m[2].length > 0 ? m[2] : 'node',
    scriptPath: m[3],
    port: Number(m[4]),
    ...(typeof m[5] === 'string' && m[5].length > 0 ? { hookEventName: m[5] } : {}),
    ...(typeof m[6] === 'string' && m[6].length > 0 ? { secretFile: m[6] } : {}),
  };
}

function parseHookForwarderCommandFromFile(filePath) {
  if (!filePath) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(raw);
    const cmd = json?.hooks?.SessionStart?.[0]?.hooks?.[0]?.command;
    return parseHookCommandString(cmd);
  } catch {
    return null;
  }
}

function parseHookForwarderCommand(settingsPath, pluginDir) {
  const pluginHooksPath = pluginDir ? path.join(pluginDir, 'hooks', 'hooks.json') : null;
  return parseHookForwarderCommandFromFile(pluginHooksPath) ?? parseHookForwarderCommandFromFile(settingsPath);
}

async function runHookForwarder(params) {
  const { hook, payload, logPath, invocationId, spawnImpl = spawn } = params;
  if (!hook) return;
  if (hook.type === 'node' && hook.scriptPath && Number.isFinite(hook.port)) {
    await new Promise((resolve) => {
      const args = [hook.scriptPath, String(hook.port)];
      if (typeof hook.hookEventName === 'string' && hook.hookEventName.length > 0) {
        args.push(hook.hookEventName);
      }
      if (typeof hook.secretFile === 'string' && hook.secretFile.length > 0) {
        args.push('--secret-file', hook.secretFile);
      }
      const child = spawnImpl(hook.runtimeExecutable || 'node', args, {
        stdio: ['pipe', 'ignore', 'ignore'],
        env: process.env,
      });
      child.on('error', (error) => {
        safeAppendJsonl(logPath, {
          type: 'hook_forwarder_error',
          invocationId,
          ts: Date.now(),
          message: error instanceof Error ? error.message : String(error),
        });
        resolve();
      });
      child.on('exit', (code, signal) => {
        if (code !== 0) {
          safeAppendJsonl(logPath, {
            type: 'hook_forwarder_nonzero_exit',
            invocationId,
            ts: Date.now(),
            code,
            signal,
          });
        }
        resolve();
      });
      try {
        child.stdin.write(JSON.stringify(payload));
      } catch (error) {
        safeAppendJsonl(logPath, {
          type: 'hook_forwarder_stdin_write_error',
          invocationId,
          ts: Date.now(),
          message: error instanceof Error ? error.message : String(error),
        });
      }
      try {
        child.stdin.end();
      } catch (error) {
        safeAppendJsonl(logPath, {
          type: 'hook_forwarder_stdin_end_error',
          invocationId,
          ts: Date.now(),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
    return;
  }

  if (hook.type === 'raw' && hook.command) {
    // Safety: never execute unparsed hook commands by default.
    safeAppendJsonl(logPath, {
      type: 'hook_skipped',
      invocationId,
      ts: Date.now(),
      reason: 'unparseable_command',
      command: hook.command,
    });
  }
}

module.exports = {
  findArgValue,
  callMcpServerTool,
  mergeMcpServers,
  parseHookForwarderCommand,
  parseMcpConfigs,
  runHookForwarder,
  safeAppendJsonl,
};
