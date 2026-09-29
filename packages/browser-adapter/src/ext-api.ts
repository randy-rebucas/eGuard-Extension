/**
 * The WebExtensions namespace. Firefox exposes `browser` (promise-based); Chromium exposes `chrome`,
 * which returns promises too under Manifest V3. We type against @types/chrome and only use calls
 * that behave the same in both. Anything that differs goes through a function in this package.
 */
export type ExtensionApi = typeof chrome;

const isExtensionApi = (x: unknown): x is ExtensionApi =>
  typeof (x as { runtime?: { id?: unknown } } | undefined)?.runtime?.id === "string";

export function getExtensionApi(): ExtensionApi {
  const g = globalThis as { browser?: unknown; chrome?: unknown };
  if (isExtensionApi(g.browser)) return g.browser;
  if (isExtensionApi(g.chrome)) return g.chrome;
  throw new Error("eGuard must run as a browser extension");
}

/** Base URL of this extension's own pages, e.g. chrome-extension://<id>/ or moz-extension://<uuid>/ */
export function extensionOrigin(api: ExtensionApi): string {
  return api.runtime.getURL("");
}

/** storage.session (memory-only) exists from Chrome 102 and Firefox 115; the types claim it always does. */
export function sessionArea(api: ExtensionApi): chrome.storage.StorageArea | undefined {
  return (api.storage as { session?: chrome.storage.StorageArea }).session;
}
