import { randomUUID } from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  createVisualRunnerMcpToolDispatcher,
  registerVisualRunnerMcpTools,
  type VisualRunnerMcpToolRegistrar,
} from './visualRunnerMcpTools.js';

export async function startVisualRunnerMcpStdioServer(): Promise<void> {
  const server = new McpServer({
    name: 'Happier Visual Runner',
    version: '0.0.0',
  });

  const registrar: VisualRunnerMcpToolRegistrar = {
    registerTool(name, definition, handler) {
      server.registerTool(name, definition, handler);
    },
  };

  registerVisualRunnerMcpTools(registrar, createVisualRunnerMcpToolDispatcher({
    defaultCwd: process.cwd(),
    generateSessionId: () => `visual-session-${randomUUID()}`,
    now: () => new Date(),
  }));

  await server.connect(new StdioServerTransport());
}
