import { logger } from '@/ui/logger';

export function logExternalIssueSessionRunInfo(message: string, context?: Record<string, unknown>): void {
  logger.debug(`[ExternalIssueSessionRun] ${message}`, context ?? {});
}

export function logExternalIssueSessionRunWarn(
  message: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  logger.warn(`[ExternalIssueSessionRun] ${message}`, error, context ?? {});
}
