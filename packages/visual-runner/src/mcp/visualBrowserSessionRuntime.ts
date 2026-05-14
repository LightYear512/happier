import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export type VisualConsoleEntry = Readonly<{
  type: string;
  text: string;
}>;

export type VisualNetworkEntry = Readonly<{
  url: string;
  method: string;
  resourceType: string;
  status: number | null;
}>;

export type BrowserSessionRuntime = Readonly<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
  consoleEntries: VisualConsoleEntry[];
  networkEntries: VisualNetworkEntry[];
}>;

export async function createBrowserRuntime(): Promise<BrowserSessionRuntime> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  const consoleEntries: VisualConsoleEntry[] = [];
  const networkEntries: VisualNetworkEntry[] = [];

  page.on('console', (message) => {
    consoleEntries.push({
      type: message.type(),
      text: message.text(),
    });
  });

  page.on('response', (response) => {
    const request = response.request();
    networkEntries.push({
      url: response.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      status: response.status(),
    });
  });

  return { browser, context, page, consoleEntries, networkEntries };
}

export async function closeBrowserRuntime(runtime: BrowserSessionRuntime | undefined): Promise<void> {
  if (!runtime) return;
  await runtime.context.close().catch(() => {});
  await runtime.browser.close().catch(() => {});
}
