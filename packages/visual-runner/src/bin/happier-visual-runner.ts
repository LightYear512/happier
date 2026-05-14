import { pathToFileURL } from 'node:url';

import { startVisualRunnerMcpStdioServer } from '../mcp/startVisualRunnerMcpStdioServer.js';

export type VisualRunnerCliDeps = Readonly<{
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  startMcpServer: () => Promise<void>;
}>;

export function createVisualRunnerCliUsage(): string {
  return [
    'Usage: happier-visual-runner mcp',
    '',
    'Commands:',
    '  mcp      Start the Visual Runner MCP stdio server',
    '  --help   Print this help text',
    '',
  ].join('\n');
}

export async function runVisualRunnerCli(
  argv: readonly string[],
  deps: VisualRunnerCliDeps = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    startMcpServer: startVisualRunnerMcpStdioServer,
  },
): Promise<number> {
  const command = argv[0] ?? '--help';

  if (command === '--help' || command === '-h') {
    deps.stdout(createVisualRunnerCliUsage());
    return 0;
  }

  if (command === 'mcp') {
    await deps.startMcpServer();
    return 0;
  }

  deps.stderr(`Unknown command: ${command}\n\n${createVisualRunnerCliUsage()}`);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runVisualRunnerCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`[happier-visual-runner] Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
