import { generateKeyPairSync, sign } from "node:crypto";
import { vi, type Mock } from "vitest";
import { createHttpClient, createTokenManager } from "@eguard/api-client";
import { fakeFetch } from "@eguard/api-client/testing";
import { memoryArea } from "@eguard/browser-adapter";
import { canonicalJson, importPolicyKey, verifyPolicySignature } from "@eguard/policy-engine";
import type { BrowserInfo } from "@eguard/schemas";
import type { DnrRule } from "@eguard/policy-engine";
import { createEnforcement, type RulesApi } from "./enforcement.ts";
import type { SafeBrowsingLevel } from "./health.ts";
import { createService, type Service } from "./service.ts";
import { createState, type State } from "./state.ts";

export type Harness = {
  service: Service;
  state: State;
  calls: ReturnType<typeof fakeFetch>["calls"];
  local: ReturnType<typeof memoryArea>;
  session: ReturnType<typeof memoryArea>;
  openTab: Mock<(url: string) => Promise<void>>;
  openBlockPage: Mock<(tabId: number, url: string) => Promise<void>>;
  /** The browser's rule store, as the fake declarativeNetRequest holds it. */
  browserRules: { dynamic: DnrRule[]; session: DnrRule[] };
  setPrivateWindows: (allowed: boolean | null) => void;
  /** Chrome's Safe Browsing setting as the fake privacy API holds it (null: the browser has no such API). */
  safeBrowsing: { value: boolean; level: SafeBrowsingLevel } | null;
  setInstallType: (t: string | null) => void;
  setHostAccess: (granted: boolean | null) => void;
  log: Mock<(event: string, detail?: Record<string, unknown>) => void>;
};

export const NOW = Date.parse("2026-09-29T10:00:00Z");
export const tok = (s: string) => `${s}_${"x".repeat(24)}`;
export const CHROME: BrowserInfo = { family: "chrome", name: "Chrome", version: "153.0.0.0", major: 153 };

export function policy(version: number, installationId = "bi_1") {
  return {
    id: "pol_1",
    childId: "c1",
    installationId,
    version,
    safeBrowsing: true,
    safeSearch: true,
    blockedCategories: ["ADULT"],
    blockedDomains: ["example.com"],
    allowedDomains: [],
    unknownSitesPolicy: "ALLOW",
    schedule: null,
    temporaryAllows: [],
    categoryDomains: { ADULT: ["adult.example"] },
    updatedAt: "2026-09-28T10:30:00Z",
  };
}

/** A signing key like the eGuard server's; the service verifies with its public half, as in production. */
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const policyKey = importPolicyKey(publicKey.export({ format: "der", type: "spki" }).toString("base64"));
export const signFor = (p: unknown) =>
  sign("sha256", Buffer.from(canonicalJson(p)), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString(
    "base64",
  );

/** The body GET /api/browser/v1/policy returns: the policy and eGuard's signature. */
export const signed = (p: object) => ({ policy: p, signature: signFor(p), keyId: "testkey" });

export const pairOk = () => ({
  status: 201,
  json: {
    installationId: "bi_1",
    familyName: "Cruz family",
    childName: "Mia",
    deviceName: "Mia's MacBook",
    accessToken: tok("at0"),
    accessTokenExpiresAt: new Date(NOW + 15 * 60_000).toISOString(),
    refreshToken: tok("rt0"),
  },
});

/** A background service wired to in-memory storage and a scripted backend. */
export function harness(
  routes: Parameters<typeof fakeFetch>[0] = {},
  browser: BrowserInfo = CHROME,
): Harness {
  const f = fakeFetch(routes);
  const local = memoryArea();
  const session = memoryArea();
  const state = createState(local, session);
  const http = createHttpClient({ baseUrl: "https://api.test", fetch: f.fetch });
  const tokens = createTokenManager({
    http,
    store: state.credentials,
    now: () => NOW,
    sleep: async () => {},
    onRevoked: () => state.forgetInstallation(),
  });
  const openTab: Mock<(url: string) => Promise<void>> = vi.fn(async (_url: string) => {});
  const log: Mock<(event: string, detail?: Record<string, unknown>) => void> = vi.fn();
  const openBlockPage: Mock<(tabId: number, url: string) => Promise<void>> = vi.fn(async () => {});
  const browserRules = { dynamic: [] as DnrRule[], session: [] as DnrRule[] };
  const rules: RulesApi = {
    getDynamic: async () => structuredClone(browserRules.dynamic),
    setDynamic: async (r) => void (browserRules.dynamic = structuredClone(r)),
    getSession: async () => structuredClone(browserRules.session),
    setSession: async (r) => void (browserRules.session = structuredClone(r)),
  };
  let privateWindows: boolean | null = true;
  let install: string | null = "normal";
  let hostAccess: boolean | null = true;
  // Only Chrome's row in the capability matrix holds Safe Browsing (index.ts decides the same way)
  const sb: Harness["safeBrowsing"] =
    browser.family === "chrome" ? { value: true, level: "controllable_by_this_extension" } : null;
  const enforcement = createEnforcement({ rules, session, alwaysAllow: ["app.test"], log });
  const service = createService({
    state,
    http,
    tokens,
    browser,
    extensionVersion: "0.1.0",
    platform: async () => "win",
    openTab,
    webAppUrl: "https://app.test",
    onboardingUrl: "chrome-extension://id/onboarding/index.html",
    verifyPolicy: async (p, s) => verifyPolicySignature(await policyKey, p, s),
    enforcement,
    privateWindowsAllowed: async () => privateWindows,
    openBlockPage,
    safeBrowsing: sb
      ? {
          get: async () => ({ ...sb }),
          set: async (value) => {
            sb.value = value;
            sb.level = "controlled_by_this_extension";
          },
          clear: async () => {
            sb.level = "controllable_by_this_extension";
          },
        }
      : null,
    installType: async () => install,
    hostAccess: async () => hostAccess,
    now: () => NOW,
    log,
  });
  return {
    service,
    state,
    calls: f.calls,
    local,
    session,
    openTab,
    log,
    openBlockPage,
    browserRules,
    setPrivateWindows: (allowed) => void (privateWindows = allowed),
    safeBrowsing: sb,
    setInstallType: (t) => void (install = t),
    setHostAccess: (granted) => void (hostAccess = granted),
  };
}
