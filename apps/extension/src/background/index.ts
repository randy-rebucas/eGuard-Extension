/**
 * Background worker. Event-driven: every listener is registered synchronously at top level (required
 * for MV3 service workers to be woken for them), and nothing keeps the worker alive between events.
 */
import { createHttpClient, createTokenManager } from "@eguard/api-client";
import {
  capabilitiesFor,
  detectCurrentBrowser,
  extensionOrigin,
  getExtensionApi,
  installType,
  memoryArea,
  safeBrowsingSetting,
  sessionArea,
} from "@eguard/browser-adapter";
import { importPolicyKey, verifyPolicySignature, type DnrRule } from "@eguard/policy-engine";
import type { ProtectionStatus } from "@eguard/schemas";
import { config } from "../config/runtime.ts";
import { log } from "./diagnostics.ts";
import { createEnforcement, type RulesApi } from "./enforcement.ts";
import type { SafeBrowsingApi, SafeBrowsingLevel } from "./health.ts";
import { handleMessage } from "./router.ts";
import { createService } from "./service.ts";
import { createState } from "./state.ts";

const SYNC_ALARM = "eguard-policy-sync";
const SYNC_PERIOD_MINUTES = 5;
/** Re-checks the rules every minute: focus hours start and end, approvals and "Continue" choices expire. */
const RULES_ALARM = "eguard-rules";

const api = getExtensionApi();
const browser = detectCurrentBrowser();
// storage.session keeps the access token in memory only; older browsers fall back to worker memory.
const session = sessionArea(api) ?? memoryArea();
const state = createState(api.storage.local, session, (key, issue) => log("storage_invalid", { key, issue }));
const http = createHttpClient({
  baseUrl: config.apiUrl,
  clientId: `${browser.family}-extension`,
  onDiagnostic: log,
});
const tokens = createTokenManager({
  http,
  store: state.credentials,
  onRevoked: async () => {
    // The parent removed this browser: forget it, and stop filtering (enforce() finds no connection)
    log("installation_revoked");
    await state.forgetInstallation();
    await service.enforce();
    // API §Disconnection: "show the setup page", which asks for a new code
    await service.openOnboarding();
  },
});

// The key that signs family policies, built in. If it can't be imported, no policy verifies: fail closed.
const policyKey = importPolicyKey(config.policyPublicKey).catch((err: unknown) => {
  log("policy_key_invalid", { error: String(err) });
  return null;
});

/** declarativeNetRequest behind the narrow interface enforcement.ts uses. */
const dnr = api.declarativeNetRequest;
const asRules = (r: DnrRule[]) => r as unknown as chrome.declarativeNetRequest.Rule[];
const rules: RulesApi = {
  getDynamic: async () => (await dnr.getDynamicRules()) as unknown as DnrRule[],
  setDynamic: async (next) => {
    const old = await dnr.getDynamicRules();
    await dnr.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules: asRules(next) });
  },
  getSession: async () => (await dnr.getSessionRules()) as unknown as DnrRule[],
  setSession: async (next) => {
    const old = await dnr.getSessionRules();
    await dnr.updateSessionRules({ removeRuleIds: old.map((r) => r.id), addRules: asRules(next) });
  },
};

const enforcement = createEnforcement({
  rules,
  session,
  // The parent dashboard always opens, so a parent can sign in from this computer
  alwaysAllow: [new URL(config.webAppUrl).hostname],
  log,
});

/** Where the capability matrix says eGuard keeps Safe Browsing on itself (Chrome), and the browser lets it. */
const sbSetting =
  capabilitiesFor(browser.family).find((c) => c.id === "BROWSER_SAFE_BROWSING")?.level === "AUTOMATIC"
    ? safeBrowsingSetting(api)
    : undefined;
const safeBrowsing: SafeBrowsingApi | null = sbSetting
  ? {
      get: async () => {
        const r = await sbSetting.get({});
        return { value: r.value === true, level: r.levelOfControl as SafeBrowsingLevel };
      },
      set: (value) => sbSetting.set({ value }),
      clear: () => sbSetting.clear({}),
    }
  : null;

const BADGE: Record<ProtectionStatus["state"], { text: string; color: string }> = {
  PROTECTED: { text: "", color: "#18A957" },
  NEEDS_ATTENTION: { text: "!", color: "#F4A62A" },
  ACTION_REQUIRED: { text: "!", color: "#EF5350" },
  SYNC_PAUSED: { text: "", color: "#5A6E92" },
  UNSUPPORTED: { text: "i", color: "#5A6E92" },
};

async function updateBadge(status: ProtectionStatus) {
  const b = BADGE[status.state];
  await api.action.setBadgeText({ text: b.text });
  await api.action.setBadgeBackgroundColor({ color: b.color });
  await api.action.setTitle({ title: `eGuard: ${status.headline}` });
}

const blockPage = api.runtime.getURL("blocked/index.html");

const service = createService({
  state,
  http,
  tokens,
  browser,
  extensionVersion: api.runtime.getManifest().version,
  platform: async () => (await api.runtime.getPlatformInfo()).os,
  openTab: async (url) => {
    await api.tabs.create({ url });
  },
  webAppUrl: config.webAppUrl,
  onboardingUrl: api.runtime.getURL("onboarding/index.html"),
  verifyPolicy: async (policy, signature) => {
    const key = await policyKey;
    return key ? verifyPolicySignature(key, policy, signature) : false;
  },
  enforcement,
  privateWindowsAllowed: () => api.extension.isAllowedIncognitoAccess(),
  openBlockPage: async (tabId, url) => {
    await api.tabs.update(tabId, { url: `${blockPage}?u=${encodeURIComponent(url)}` });
  },
  safeBrowsing,
  installType: () => installType(api),
  log,
  onStatus: (s) => updateBadge(s).catch((err: unknown) => log("badge_failed", { error: String(err) })),
});

const trust = { runtimeId: api.runtime.id, extensionBase: extensionOrigin(api) };

api.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  void handleMessage(message, sender, service, trust, log).then(sendResponse);
  return true; // respond asynchronously (works in Chrome and Firefox)
});

/**
 * The browser blocks with a plain block rule (no access to all sites needed), which shows its own error page.
 * Only failed top-level loads reach this listener; eGuard re-evaluates the URL and, if it blocked it, swaps
 * in the eGuard block page. Nothing is stored.
 */
api.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0) return;
  void service
    .onNavigationError(details.tabId, details.url)
    .catch((err: unknown) => log("block_page_failed", { error: String(err) }));
});

async function ensureAlarms() {
  if (!(await api.alarms.get(SYNC_ALARM))) {
    await api.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES, delayInMinutes: 1 });
  }
  if (!(await api.alarms.get(RULES_ALARM))) {
    await api.alarms.create(RULES_ALARM, { periodInMinutes: 1 });
  }
}

api.alarms.onAlarm.addListener((alarm) => {
  void (async () => {
    if (alarm.name === SYNC_ALARM) await service.periodic();
    if (alarm.name === RULES_ALARM) await service.enforce();
    await service.getStatus();
  })().catch((err: unknown) => log("alarm_failed", { alarm: alarm.name, error: String(err) }));
});

function start() {
  void ensureAlarms();
  // Rules persist across restarts, but the clock may have moved past a focus-hours boundary meanwhile.
  // Then sync straight away (API: "every 5 minutes, and on browser start"): the browser may have been closed for
  // days, and the parent sees it check in now rather than at the first alarm.
  void service
    .enforce()
    .then(() => service.periodic())
    .then(() => service.getStatus())
    .catch((err: unknown) => log("startup_failed", { error: String(err) }));
}

api.runtime.onInstalled.addListener((details) => {
  start();
  if (details.reason === "install") void service.openOnboarding();
});

api.runtime.onStartup.addListener(start);
