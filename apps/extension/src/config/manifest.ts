import { MIN_VERSION } from "@eguard/browser-adapter";
import { SAFE_SEARCH_ENGINES } from "@eguard/policy-engine";
import type { BuildTarget } from "@eguard/schemas";
import type { Env } from "./env.ts";

export const GECKO_ID = "browser-extension@eguard.family";

/**
 * What Firefox shows at install and AMO requires (docs/PUBLISHING.md §6.3, docs/PRIVACY.md).
 * browsingActivity: an access request sends the address of the site the child asks for, and the daily
 * counts are blocked pages per category. Browser/OS details and health-check results are how the
 * service works (the parent's status and alerts), not usage telemetry, so they aren't declared as the
 * optional-only technicalAndInteraction, which the person could decline.
 */
export const FIREFOX_DATA_COLLECTION = { required: ["browsingActivity"] };

/**
 * Permissions, each with a documented reason in docs/SECURITY.md#permissions. We deliberately never request
 * <all_urls>: blocking uses plain block rules, which need no host access.
 */
export const PERMISSIONS = ["storage", "alarms", "declarativeNetRequest", "webNavigation"] as const;

/**
 * Chrome only: keeps Chrome's Safe Browsing on (privacy.services.safeBrowsingEnabled). Edge ignores that setting
 * (SmartScreen is separate) and Firefox has no such API, so their builds don't ask for it.
 */
export const CHROME_ONLY_PERMISSIONS = ["privacy"] as const;

/** SafeSearch redirects need host access to the search engines, and only those. */
export const SEARCH_HOST_PERMISSIONS = [
  ...new Set(SAFE_SEARCH_ENGINES.map((e) => `*://*.${e.host.replace(/^www\./, "")}/*`)),
];

export type ManifestInput = { target: BuildTarget; version: string; env: Env };

export function buildManifest({ target, version, env }: ManifestInput): Record<string, unknown> {
  const dev = env.VITE_ENVIRONMENT !== "production";
  const icons = {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  };
  // The API origin is the only host we contact. Host permission lets the worker call it without CORS.
  const hostPermissions = [`${env.VITE_API_URL}/*`, ...SEARCH_HOST_PERMISSIONS];
  const connectSrc = ["'self'", env.VITE_API_URL].join(" ");

  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: dev ? `eGuard Browser Protection (${env.VITE_ENVIRONMENT})` : "eGuard Browser Protection",
    short_name: "eGuard",
    description: "Simple digital protection for your family: safer browsing that eGuard keeps verified.",
    version,
    icons,
    action: { default_title: "eGuard", default_popup: "popup/index.html", default_icon: icons },
    options_ui: { page: "options/index.html", open_in_tab: true },
    permissions: [...PERMISSIONS, ...(target === "chrome" ? CHROME_ONLY_PERMISSIONS : [])],
    host_permissions: hostPermissions,
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src ${connectSrc}`,
    },
  };

  if (target === "firefox") {
    manifest.background = { scripts: ["background.js"] };
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: `${MIN_VERSION.firefox}.0`,
        data_collection_permissions: FIREFOX_DATA_COLLECTION,
      },
      // Firefox for Android reads data_collection_permissions from 142
      gecko_android: { strict_min_version: "142.0" },
    };
  } else {
    manifest.background = { service_worker: "background.js" };
    manifest.minimum_chrome_version = "120";
  }
  return manifest;
}
