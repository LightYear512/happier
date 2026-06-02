import type { SimulatorPreviewNormalizedInput } from './createAndroidSimulatorPreviewControlRegistry';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type IosWebDriverAgentInputBridge = ReturnType<typeof createIosWebDriverAgentInputBridge>;

export type IosWebDriverAgentInputBridgeOptions = Readonly<{
  fetch?: FetchLike;
  wdaUrl?: string;
}>;

export type SendIosWebDriverAgentInputRequest = Readonly<{
  deviceId?: string;
  wdaUrl?: string;
  input: SimulatorPreviewNormalizedInput;
}>;

type WdaSessionState = Readonly<{
  sessionId: string;
}>;

const DEFAULT_WDA_URL = 'http://127.0.0.1:8100';

function clampNormalized(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function resolveBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/u, '');
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as unknown;
}

function extractSessionId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = 'value' in payload ? (payload as { value?: unknown }).value : payload;
  if (!value || typeof value !== 'object') return null;
  const direct = (value as { sessionId?: unknown }).sessionId;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const nested = (value as { capabilities?: { sessionId?: unknown } }).capabilities?.sessionId;
  return typeof nested === 'string' && nested.trim() ? nested.trim() : null;
}

function extractWindowSize(payload: unknown): { width: number; height: number } {
  if (!payload || typeof payload !== 'object') throw new Error('wda_window_size_missing');
  const value = 'value' in payload ? (payload as { value?: unknown }).value : payload;
  if (!value || typeof value !== 'object') throw new Error('wda_window_size_missing');
  const width = Number((value as { width?: unknown }).width);
  const height = Number((value as { height?: unknown }).height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('wda_window_size_invalid');
  }
  return { width, height };
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function buildSessionCapabilities(deviceId?: string): Record<string, unknown> {
  const udid = deviceId?.trim();
  if (!udid) return {};
  return {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': udid,
    'appium:wdaLaunchTimeout': 180_000,
  };
}

function buildPointerActions(input: Extract<SimulatorPreviewNormalizedInput, { type: 'tap' | 'swipe' }>, size: { width: number; height: number }) {
  if (input.type === 'tap') {
    return {
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, origin: 'viewport', x: Math.round(clampNormalized(input.x) * size.width), y: Math.round(clampNormalized(input.y) * size.height) },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 50 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    };
  }
  return {
    actions: [
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, origin: 'viewport', x: Math.round(clampNormalized(input.x1) * size.width), y: Math.round(clampNormalized(input.y1) * size.height) },
          { type: 'pointerDown', button: 0 },
          {
            type: 'pointerMove',
            duration: input.durationMs ?? 250,
            origin: 'viewport',
            x: Math.round(clampNormalized(input.x2) * size.width),
            y: Math.round(clampNormalized(input.y2) * size.height),
          },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  };
}

export function createIosWebDriverAgentInputBridge(options: IosWebDriverAgentInputBridgeOptions = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const defaultWdaUrl = resolveBaseUrl(options.wdaUrl ?? DEFAULT_WDA_URL);
  const sessions = new Map<string, WdaSessionState>();

  const request = async (url: string, init?: RequestInit) => {
    const response = await fetchImpl(url, init);
    if (!response.ok) {
      throw new Error(`wda_request_failed:${response.status}`);
    }
    return await readJson(response);
  };

  const getSession = async (baseUrl: string, deviceId?: string): Promise<WdaSessionState> => {
    const sessionKey = `${baseUrl}\u0000${deviceId?.trim() ?? ''}`;
    const existing = sessions.get(sessionKey);
    if (existing) return existing;
    const payload = await request(`${baseUrl}/session`, jsonRequest({
      capabilities: {
        alwaysMatch: buildSessionCapabilities(deviceId),
        firstMatch: [{}],
      },
    }));
    const sessionId = extractSessionId(payload);
    if (!sessionId) throw new Error('wda_session_missing');
    const session = { sessionId };
    sessions.set(sessionKey, session);
    return session;
  };

  const getWindowSize = async (baseUrl: string, sessionId: string) => {
    const payload = await request(`${baseUrl}/session/${encodeURIComponent(sessionId)}/window/size`, { method: 'GET' });
    return extractWindowSize(payload);
  };

  return {
    async sendInput(requestInput: SendIosWebDriverAgentInputRequest) {
      const baseUrl = resolveBaseUrl(requestInput.wdaUrl ?? defaultWdaUrl);
      const session = await getSession(baseUrl, requestInput.deviceId);
      if (requestInput.input.type === 'tap' || requestInput.input.type === 'swipe') {
        const size = await getWindowSize(baseUrl, session.sessionId);
        await request(
          `${baseUrl}/session/${encodeURIComponent(session.sessionId)}/actions`,
          jsonRequest(buildPointerActions(requestInput.input, size)),
        );
        return { ok: true as const };
      }
      if (requestInput.input.type === 'text') {
        await request(
          `${baseUrl}/session/${encodeURIComponent(session.sessionId)}/wda/keys`,
          jsonRequest({ value: [...requestInput.input.text] }),
        );
        return { ok: true as const };
      }
      if (requestInput.input.key === 'home') {
        await request(
          `${baseUrl}/session/${encodeURIComponent(session.sessionId)}/wda/pressButton`,
          jsonRequest({ name: 'home' }),
        );
        return { ok: true as const };
      }
      if (requestInput.input.key === 'enter') {
        await request(
          `${baseUrl}/session/${encodeURIComponent(session.sessionId)}/wda/keys`,
          jsonRequest({ value: ['\n'] }),
        );
        return { ok: true as const };
      }
      return { ok: false as const, errorCode: 'unsupported_ios_keyevent' as const, error: 'unsupported_ios_keyevent' as const };
    },
  };
}
