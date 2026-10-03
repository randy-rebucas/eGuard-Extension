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

type ChromeSetting = {
  get(details: object): Promise<{ value: unknown; levelOfControl: string }>;
  set(details: { value: unknown }): Promise<void>;
  clear(details: object): Promise<void>;
};

/**
 * privacy.services.safeBrowsingEnabled: only Chromium has it, and only with the `privacy` permission (the
 * Chrome build). Undefined elsewhere; the types claim it always exists.
 */
export function safeBrowsingSetting(api: ExtensionApi): ChromeSetting | undefined {
  const privacy = (api as { privacy?: { services?: { safeBrowsingEnabled?: ChromeSetting } } }).privacy;
  return privacy?.services?.safeBrowsingEnabled;
}

/**
 * management.getSelf().installType: "admin" when a browser policy force-installed eGuard (it can't be removed
 * then). getSelf needs no permission in Chrome, Edge or Firefox. null where the browser can't say.
 */
export async function installType(api: ExtensionApi): Promise<string | null> {
  const management = (api as { management?: { getSelf?: () => Promise<{ installType?: string }> } })
    .management;
  if (!management?.getSelf) return null;
  return (await management.getSelf()).installType ?? null;
}

/**
 * Whether every host permission in the manifest is still granted. People can withdraw them (Chrome/Edge "Site
 * access", Firefox's add-on Permissions tab); permissions.contains needs no permission. null where unavailable.
 */
export async function hostAccess(api: ExtensionApi): Promise<boolean | null> {
  const permissions = (api as { permissions?: { contains?: (p: { origins: string[] }) => Promise<boolean> } })
    .permissions;
  const origins = (api.runtime.getManifest() as { host_permissions?: string[] }).host_permissions ?? [];
  if (!permissions?.contains || !origins.length) return null;
  return permissions.contains({ origins });
}

/** storage.session (memory-only) exists from Chrome 102 and Firefox 115; the types claim it always does. */
export function sessionArea(api: ExtensionApi): chrome.storage.StorageArea | undefined {
  return (api.storage as { session?: chrome.storage.StorageArea }).session;
}
