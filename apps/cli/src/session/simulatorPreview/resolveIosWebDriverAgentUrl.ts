export type ResolveIosWebDriverAgentUrlOptions = Readonly<{
  env?: NodeJS.ProcessEnv;
  fetchStatus?: (url: string) => Promise<Readonly<{ ok: boolean }>>;
}>;

const DEFAULT_APPIUM_URL = 'http://127.0.0.1:4723';
const DEFAULT_WDA_URL = 'http://127.0.0.1:8100';

function normalizeBaseUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/u, '') : '';
}

async function defaultFetchStatus(url: string): Promise<Readonly<{ ok: boolean }>> {
  try {
    const response = await fetch(url, { method: 'GET' });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

export async function resolveIosWebDriverAgentUrl(
  options: ResolveIosWebDriverAgentUrlOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const configured = normalizeBaseUrl(env.HAPPIER_IOS_WDA_URL ?? env.HAPPIER_TEST_IOS_WDA_URL);
  if (configured) return configured;

  const fetchStatus = options.fetchStatus ?? defaultFetchStatus;
  if ((await fetchStatus(`${DEFAULT_APPIUM_URL}/status`)).ok) {
    return DEFAULT_APPIUM_URL;
  }
  if ((await fetchStatus(`${DEFAULT_WDA_URL}/status`)).ok) {
    return DEFAULT_WDA_URL;
  }
  return DEFAULT_WDA_URL;
}
