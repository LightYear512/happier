import {
  VisualPolicySchema,
  VisualSessionSchema,
  redactVisualTextArtifact,
  resolveVisualUrlPolicy,
  type ResolvedVisualPolicy,
  type VisualPolicy,
  type VisualSession,
} from '../contract.js';
import {
  closeBrowserRuntime,
  createBrowserRuntime,
  type BrowserSessionRuntime,
} from './visualBrowserSessionRuntime.js';
import { createVisualDashboardServer, type VisualDashboardServer } from './visualDashboardServer.js';
import { createSessionArtifactStore } from './visualArtifactStore.js';
import {
  CreateSessionInputSchema,
  NavigateInputSchema,
  RedactTextArtifactInputSchema,
  ResolveUrlPolicyInputSchema,
  ScreenshotInputSchema,
  SessionIdInputSchema,
  TargetInputSchema,
  TypeInputSchema,
  visualRunnerMcpToolDefinitions,
  type VisualRunnerMcpToolDefinition,
  type VisualRunnerMcpToolName,
} from './visualRunnerMcpToolCatalog.js';
import {
  invalidArgumentsResult,
  mcpTextJson,
  sessionNotFoundResult,
  unknownToolResult,
  visualErrorResult,
  type VisualRunnerMcpToolResult,
} from './visualRunnerMcpToolResults.js';

export { visualRunnerMcpToolNames } from './visualRunnerMcpToolCatalog.js';
export type {
  VisualRunnerMcpToolDefinition,
  VisualRunnerMcpToolName,
} from './visualRunnerMcpToolCatalog.js';
export type { VisualRunnerMcpToolResult } from './visualRunnerMcpToolResults.js';

const VISUAL_ACTION_SETTLE_MS = 250;

export type VisualRunnerMcpToolDispatcher = Readonly<{
  callTool: (name: string, args: unknown) => Promise<VisualRunnerMcpToolResult>;
}>;

export type VisualRunnerMcpToolRegistrar = Readonly<{
  registerTool: (
    name: string,
    definition: VisualRunnerMcpToolDefinition,
    handler: (args: unknown) => Promise<VisualRunnerMcpToolResult>,
  ) => void;
}>;

export function createVisualRunnerMcpToolDispatcher(params: Readonly<{
  defaultCwd: string;
  generateSessionId: () => string;
  now: () => Date;
}>): VisualRunnerMcpToolDispatcher {
  const sessions = new Map<string, VisualSession>();
  const runtimes = new Map<string, BrowserSessionRuntime>();
  let dashboardServer: VisualDashboardServer | null = null;

  return {
    async callTool(name, args) {
      if (name === 'visual.resolve_url_policy') {
        const parsed = ResolveUrlPolicyInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);
        return mcpTextJson(resolveVisualUrlPolicy(parsed.data));
      }

      if (name === 'visual.redact_text_artifact') {
        const parsed = RedactTextArtifactInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);
        return mcpTextJson({ text: redactVisualTextArtifact(parsed.data.text) });
      }

      if (name === 'visual.create_session') {
        const parsed = CreateSessionInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);

        const session = VisualSessionSchema.parse({
          id: params.generateSessionId(),
          cwd: parsed.data.cwd ?? params.defaultCwd,
          createdAt: params.now().toISOString(),
          status: 'running',
          policy: resolvePolicy(parsed.data.policy),
        });
        sessions.set(session.id, session);

        return mcpTextJson(session);
      }

      if (name === 'visual.navigate') {
        const parsed = NavigateInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);

        const session = sessions.get(parsed.data.sessionId);
        if (!session) return sessionNotFoundResult(parsed.data.sessionId);

        const policyResult = resolveVisualUrlPolicy({
          url: parsed.data.url,
          policy: session.policy,
        });
        if (!policyResult.ok) return mcpTextJson(policyResult, true);

        let runtime = runtimes.get(session.id);
        try {
          if (!runtime) {
            runtime = await createBrowserRuntime();
            runtimes.set(session.id, runtime);
          }

          await runtime.page.goto(parsed.data.url, { waitUntil: 'networkidle' });
          return mcpTextJson({
            status: 'ok',
            sessionId: session.id,
            url: runtime.page.url(),
            title: await runtime.page.title(),
          });
        } catch (error) {
          return visualErrorResult('browser_launch_failed', error instanceof Error ? error.message : String(error), {
            sessionId: session.id,
          });
        }
      }

      if (name === 'visual.screenshot') {
        const parsed = ScreenshotInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);

        const session = sessions.get(parsed.data.sessionId);
        if (!session) return sessionNotFoundResult(parsed.data.sessionId);

        const runtime = runtimes.get(session.id);
        if (!runtime) {
          return visualErrorResult('session_not_found', 'visual session has no active browser page', {
            sessionId: session.id,
          });
        }

        try {
          const artifact = await createSessionArtifactStore(session, params).writeArtifact({
            kind: 'screenshot',
            mimeType: 'image/png',
            extension: 'png',
            write: async (artifactPath) => {
              await runtime.page.screenshot({ path: artifactPath, fullPage: true });
            },
          });

          return mcpTextJson({
            status: 'ok',
            sessionId: session.id,
            screenshotRef: artifact.artifactRef,
            artifactPath: artifact.artifactPath,
          });
        } catch (error) {
          return visualErrorResult('artifact_write_failed', error instanceof Error ? error.message : String(error), {
            sessionId: session.id,
          });
        }
      }

      if (name === 'visual.get_trace') {
        const parsed = ScreenshotInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);

        const session = sessions.get(parsed.data.sessionId);
        if (!session) return sessionNotFoundResult(parsed.data.sessionId);

        const runtime = runtimes.get(session.id);
        if (!runtime) {
          return visualErrorResult('session_not_found', 'visual session has no active browser page', {
            sessionId: session.id,
          });
        }

        try {
          const artifact = await createSessionArtifactStore(session, params).writeArtifact({
            kind: 'trace',
            mimeType: 'application/zip',
            extension: 'zip',
            write: async (artifactPath) => {
              await runtime.context.tracing.stop({ path: artifactPath });
              await runtime.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
            },
          });

          return mcpTextJson({
            status: 'ok',
            sessionId: session.id,
            traceRef: artifact.artifactRef,
            artifactPath: artifact.artifactPath,
          });
        } catch (error) {
          return visualErrorResult('artifact_write_failed', error instanceof Error ? error.message : String(error), {
            sessionId: session.id,
          });
        }
      }

      if (name === 'visual.type') {
        const parsed = TypeInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);

        const session = sessions.get(parsed.data.sessionId);
        if (!session) return sessionNotFoundResult(parsed.data.sessionId);
        const runtime = runtimes.get(session.id);
        if (!runtime) return sessionNotFoundResult(session.id);

        try {
          await runtime.page.locator(parsed.data.target).first().fill(parsed.data.text);
          return mcpTextJson({
            status: 'ok',
            sessionId: session.id,
            target: parsed.data.target,
          });
        } catch (error) {
          return visualErrorResult('target_not_found', error instanceof Error ? error.message : String(error), {
            sessionId: session.id,
            target: parsed.data.target,
          });
        }
      }

      if (name === 'visual.click') {
        const parsed = TargetInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);

        const session = sessions.get(parsed.data.sessionId);
        if (!session) return sessionNotFoundResult(parsed.data.sessionId);
        const runtime = runtimes.get(session.id);
        if (!runtime) return sessionNotFoundResult(session.id);

        try {
          await runtime.page.locator(parsed.data.target).first().click();
          await runtime.page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
          await runtime.page.waitForTimeout(VISUAL_ACTION_SETTLE_MS);
          return mcpTextJson({
            status: 'ok',
            sessionId: session.id,
            target: parsed.data.target,
          });
        } catch (error) {
          return visualErrorResult('target_not_found', error instanceof Error ? error.message : String(error), {
            sessionId: session.id,
            target: parsed.data.target,
          });
        }
      }

      if (name === 'visual.inspect') {
        const parsed = ScreenshotInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);

        const session = sessions.get(parsed.data.sessionId);
        if (!session) return sessionNotFoundResult(parsed.data.sessionId);
        const runtime = runtimes.get(session.id);
        if (!runtime) return sessionNotFoundResult(session.id);

        return mcpTextJson({
          status: 'ok',
          sessionId: session.id,
          url: runtime.page.url(),
          title: await runtime.page.title(),
          text: await runtime.page.evaluate('document.body.textContent || ""'),
        });
      }

      if (name === 'visual.get_console') {
        const parsed = ScreenshotInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);

        const session = sessions.get(parsed.data.sessionId);
        if (!session) return sessionNotFoundResult(parsed.data.sessionId);
        const runtime = runtimes.get(session.id);
        if (!runtime) return sessionNotFoundResult(session.id);

        return mcpTextJson({
          status: 'ok',
          sessionId: session.id,
          entries: runtime.consoleEntries.map((entry) => ({
            type: entry.type,
            text: redactVisualTextArtifact(entry.text),
          })),
        });
      }

      if (name === 'visual.get_network') {
        const parsed = ScreenshotInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);

        const session = sessions.get(parsed.data.sessionId);
        if (!session) return sessionNotFoundResult(parsed.data.sessionId);
        const runtime = runtimes.get(session.id);
        if (!runtime) return sessionNotFoundResult(session.id);

        return mcpTextJson({
          status: 'ok',
          sessionId: session.id,
          entries: runtime.networkEntries.map((entry) => ({
            url: redactVisualTextArtifact(entry.url),
            method: entry.method,
            resourceType: entry.resourceType,
            status: entry.status,
          })),
        });
      }

      if (name === 'visual.get_dashboard') {
        const parsed = ScreenshotInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);

        const session = sessions.get(parsed.data.sessionId);
        if (!session) return sessionNotFoundResult(parsed.data.sessionId);

        dashboardServer ??= createVisualDashboardServer();
        const dashboardUrl = await dashboardServer.registerSession({
          sessionId: session.id,
          artifactDir: createSessionArtifactStore(session, params).artifactDir,
        });

        return mcpTextJson({
          status: 'ok',
          sessionId: session.id,
          dashboardUrl,
        });
      }

      if (name === 'visual.get_session') {
        const parsed = SessionIdInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);

        const session = sessions.get(parsed.data.sessionId);
        if (!session) return sessionNotFoundResult(parsed.data.sessionId);

        return mcpTextJson(session);
      }

      if (name === 'visual.close_session') {
        const parsed = SessionIdInputSchema.safeParse(args);
        if (!parsed.success) return invalidArgumentsResult(parsed.error);

        const session = sessions.get(parsed.data.sessionId);
        if (!session) return sessionNotFoundResult(parsed.data.sessionId);

        const closedSession = VisualSessionSchema.parse({
          ...session,
          status: 'closed',
        });
        sessions.delete(parsed.data.sessionId);
        const runtime = runtimes.get(parsed.data.sessionId);
        runtimes.delete(parsed.data.sessionId);
        await closeBrowserRuntime(runtime);

        return mcpTextJson(closedSession);
      }

      return unknownToolResult(name);
    },
  };
}

function resolvePolicy(policy: VisualPolicy | undefined): ResolvedVisualPolicy {
  return VisualPolicySchema.parse(policy ?? {});
}

export function registerVisualRunnerMcpTools(
  server: VisualRunnerMcpToolRegistrar,
  dispatcher: VisualRunnerMcpToolDispatcher,
): void {
  for (const tool of visualRunnerMcpToolDefinitions) {
    server.registerTool(
      tool.name,
      tool.definition,
      (args) => dispatcher.callTool(tool.name, args),
    );
  }
}
