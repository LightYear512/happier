import { z } from 'zod';

export type VisualRunnerMcpToolResult = Readonly<{
  content: [{ type: 'text'; text: string }];
  isError: boolean;
}>;

export function mcpTextJson(payload: unknown, isError = false): VisualRunnerMcpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError,
  };
}

export function invalidArgumentsResult(error: z.ZodError): VisualRunnerMcpToolResult {
  return mcpTextJson({
    errorCode: 'invalid_arguments',
    issues: error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path,
      message: issue.message,
    })),
  }, true);
}

export function unknownToolResult(name: string): VisualRunnerMcpToolResult {
  return mcpTextJson({
    errorCode: 'unknown_tool',
    toolName: name,
  }, true);
}

export function sessionNotFoundResult(sessionId: string): VisualRunnerMcpToolResult {
  return mcpTextJson({
    errorCode: 'session_not_found',
    sessionId,
  }, true);
}

export function visualErrorResult(errorCode: string, message: string, details: Record<string, unknown> = {}): VisualRunnerMcpToolResult {
  return mcpTextJson({
    errorCode,
    message,
    ...details,
  }, true);
}
