import { describe, expect, it } from "vitest";
import type { BrowserInfo, HealthCheck } from "@eguard/schemas";
import { buildChecks, dayIn, reportKey, type HealthInput } from "./health.ts";

const NOW = Date.parse("2026-09-29T10:00:00Z");
const CHROME: BrowserInfo = { family: "chrome", name: "Chrome", version: "153.0.0.0", major: 153 };
const FIREFOX: BrowserInfo = { family: "firefox", name: "Firefox", version: "140.0", major: 140 };
const EDGE: BrowserInfo = { family: "edge", name: "Edge", version: "153.0.0.0", major: 153 };

const healthy = (patch: Partial<HealthInput> = {}): HealthInput => ({
  browser: CHROME,
  policyVersion: 4,
  wantsSafeBrowsing: true,
  rulesVerified: true,
  privateWindowsAllowed: true,
  sync: { lastAttemptAt: "2026-09-29T09:58:00Z", lastSuccessAt: "2026-09-29T09:58:00Z", lastError: null },
  safeBrowsing: { value: true, level: "controlled_by_this_extension" },
  installType: "admin",
  hostAccess: true,
  now: NOW,
  ...patch,
});
const byId = (checks: HealthCheck[]) => Object.fromEntries(checks.map((c) => [c.id, c]));
const statuses = (i: HealthInput) => Object.fromEntries(buildChecks(i).map((c) => [c.id, c.status]));

describe("buildChecks", () => {
  it("lists the seven checks in a fixed order, all passing on a fully set-up Chrome", () => {
    const checks = buildChecks(healthy());
    expect(checks.map((c) => c.id)).toEqual([
      "policy_signature",
      "rules_installed",
      "private_windows",
      "site_access",
      "sync_fresh",
      "safe_browsing",
      "force_installed",
    ]);
    expect(checks.every((c) => c.status === "PASS")).toBe(true);
    expect(byId(checks).safe_browsing?.detail).toMatch(/can't be switched off/);
  });

  it("without a verified policy: settings missing, rules and Safe Browsing waiting", () => {
    expect(
      statuses(healthy({ policyVersion: null, wantsSafeBrowsing: null, rulesVerified: false })),
    ).toMatchObject({
      policy_signature: "ACTION_REQUIRED",
      rules_installed: "NOT_CONFIGURED",
      safe_browsing: "NOT_CONFIGURED",
    });
  });

  it("rules that don't match the policy need action", () => {
    const c = byId(buildChecks(healthy({ rulesVerified: false })));
    expect(c.rules_installed).toMatchObject({ status: "ACTION_REQUIRED", title: "Website rules not active" });
  });

  it("private windows: allowed, not allowed (with each browser's steps), or not knowable", () => {
    const off = byId(buildChecks(healthy({ privateWindowsAllowed: false }))).private_windows;
    expect(off?.status).toBe("WARNING");
    expect(off?.detail).toContain("Allow in Incognito");
    expect(
      byId(buildChecks(healthy({ browser: EDGE, privateWindowsAllowed: false }))).private_windows?.detail,
    ).toContain("Allow in InPrivate");
    expect(statuses(healthy({ privateWindowsAllowed: null })).private_windows).toBe("UNSUPPORTED");
  });

  it("site access: withdrawn in the browser's settings needs a parent, with that browser's steps", () => {
    const off = byId(buildChecks(healthy({ hostAccess: false }))).site_access;
    expect(off?.status).toBe("ACTION_REQUIRED");
    expect(off?.detail).toContain("SafeSearch is off");
    expect(off?.detail).toContain("chrome://extensions");
    expect(byId(buildChecks(healthy({ browser: FIREFOX, hostAccess: false }))).site_access?.detail).toContain(
      "Permissions",
    );
    expect(statuses(healthy({ hostAccess: null })).site_access).toBe("UNSUPPORTED");
  });

  it("sync is stale after a day without success, or while eGuard can't be reached", () => {
    expect(statuses(healthy({ sync: null })).sync_fresh).toBe("WARNING");
    expect(
      statuses(
        healthy({ sync: { lastAttemptAt: null, lastSuccessAt: "2026-09-28T09:00:00Z", lastError: null } }),
      ).sync_fresh,
    ).toBe("WARNING");
    const offline = buildChecks(
      healthy({
        sync: {
          lastAttemptAt: "2026-09-29T09:59:00Z",
          lastSuccessAt: "2026-09-29T09:00:00Z",
          lastError: { kind: "network", message: "We couldn't reach eGuard.", at: "2026-09-29T09:59:00Z" },
        },
      }),
    );
    expect(byId(offline).sync_fresh).toMatchObject({
      status: "WARNING",
      detail: "We couldn't reach eGuard. The last settings stay active.",
    });
  });

  it("Safe Browsing: off in the family's settings, or off and held by someone else", () => {
    expect(statuses(healthy({ wantsSafeBrowsing: false })).safe_browsing).toBe("NOT_CONFIGURED");
    const other = byId(
      buildChecks(healthy({ safeBrowsing: { value: false, level: "controlled_by_other_extensions" } })),
    );
    expect(other.safe_browsing?.status).toBe("ACTION_REQUIRED");
    expect(other.safe_browsing?.detail).toContain("Another extension");
    const policy = byId(buildChecks(healthy({ safeBrowsing: { value: false, level: "not_controllable" } })));
    expect(policy.safe_browsing?.detail).toMatch(/Standard or Enhanced protection/);
  });

  it("Safe Browsing in Edge and Firefox is the parent's to check, never claimed", () => {
    const fx = byId(buildChecks(healthy({ browser: FIREFOX, safeBrowsing: null })));
    expect(fx.safe_browsing?.status).toBe("UNSUPPORTED");
    expect(fx.safe_browsing?.detail).toContain("Block dangerous and deceptive content");
    expect(byId(buildChecks(healthy({ browser: EDGE, safeBrowsing: null }))).safe_browsing?.detail).toContain(
      "SmartScreen",
    );
  });

  it("removal protection: force-installed passes; otherwise not set up, with how", () => {
    const removable = byId(buildChecks(healthy({ installType: "normal" }))).force_installed;
    expect(removable?.status).toBe("NOT_CONFIGURED");
    expect(removable?.detail).toContain("force-installs eGuard");
    expect(statuses(healthy({ installType: null })).force_installed).toBe("UNSUPPORTED");
  });
});

describe("reportKey", () => {
  it("changes with the state, the version or any check's status, not with wording", () => {
    const base = {
      state: "PROTECTED",
      policyVersion: 3,
      checks: [{ id: "rules_installed", status: "PASS" }],
    };
    expect(reportKey(base)).toBe(reportKey({ ...base, checks: [{ id: "rules_installed", status: "PASS" }] }));
    expect(reportKey(base)).not.toBe(reportKey({ ...base, policyVersion: 4 }));
    expect(reportKey(base)).not.toBe(
      reportKey({ ...base, checks: [{ id: "rules_installed", status: "WARNING" }] }),
    );
  });
});

describe("dayIn", () => {
  it("dates by the family's time zone, and falls back to UTC for an unknown zone", () => {
    const late = new Date("2026-09-28T20:00:00Z");
    expect(dayIn("Asia/Manila", late)).toBe("2026-09-29");
    expect(dayIn("America/New_York", late)).toBe("2026-09-28");
    expect(dayIn("Not/AZone", late)).toBe("2026-09-28");
  });
});
