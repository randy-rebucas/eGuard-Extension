import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { startMockBackend } from "./mock-backend.ts";

export const E2E_PORT = 3299;
export const EXTENSION_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist-e2e/chrome",
);

type Fixtures = {
  backend: Awaited<ReturnType<typeof startMockBackend>>;
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  openPopup: () => Promise<Page>;
};

/**
 * Loads the built extension into Playwright's Chromium. (Branded Chrome 137+ ignores --load-extension,
 * so these tests use the bundled Chromium, which runs the same extension platform.)
 */
export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring pattern
  backend: async ({}, use) => {
    const backend = await startMockBackend(E2E_PORT);
    await use(backend);
    await backend.close();
  },
  context: async ({ backend: _ }, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        // Test "websites": every *.example host resolves to the mock server (use http://<name>.example:3299/)
        "--host-resolver-rules=MAP *.example 127.0.0.1",
      ],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
  openPopup: async ({ context, extensionId }, use) => {
    await use(async () => {
      const page = await context.newPage();
      await page.setViewportSize({ width: 360, height: 600 });
      await page.goto(`chrome-extension://${extensionId}/popup/index.html`);
      return page;
    });
  },
});

export { expect } from "@playwright/test";

/** Evaluates in the service worker, where the extension APIs live. */
export function badgeText(worker: Worker) {
  return worker.evaluate(() => chrome.action.getBadgeText({}));
}

/** Waits for the onboarding tab the extension opens on first install. */
export async function onboardingPage(context: BrowserContext, extensionId: string) {
  const url = `chrome-extension://${extensionId}/onboarding/index.html`;
  const existing = context.pages().find((p) => p.url() === url);
  return existing ?? (await context.waitForEvent("page", { predicate: (p) => p.url() === url }));
}
