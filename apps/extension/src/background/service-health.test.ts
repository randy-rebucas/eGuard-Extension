import { describe, expect, it } from "vitest";
import type { Handler } from "@eguard/api-client/testing";
import type { BrowserInfo } from "@eguard/schemas";
import { dayIn } from "./health.ts";
import { KEEP_COUNTS_DAYS } from "./service.ts";
import { NOW, harness, pairOk, policy, signed } from "./test-harness.ts";

const PAIR = "/api/browser/v1/pair";
const POLICY = "/api/browser/v1/policy";
const HEALTH = "/api/browser/v1/health";
const EVENTS = "/api/browser/v1/events";
const FIREFOX: BrowserInfo = { family: "firefox", name: "Firefox", version: "140.0", major: 140 };

const accepted: Handler = () => ({ status: 200, json: { ok: true, score: 5, total: 5 } });

async function paired(
  routes: Record<string, Handler | Handler[]> = {},
  browser?: BrowserInfo,
  p: object = policy(1),
) {
  const h = harness(
    { [PAIR]: pairOk, [POLICY]: () => ({ status: 200, json: signed(p) }), [HEALTH]: accepted, ...routes },
    browser,
  );
  await h.service.pairWithCode("824917");
  return h;
}
const reports = (h: Awaited<ReturnType<typeof paired>>) => h.calls.filter((c) => c.path === HEALTH);

describe("health reports", () => {
  it("go to eGuard right after pairing: state, policy version and each check's status, nothing else", async () => {
    const h = await paired();
    expect(reports(h)).toHaveLength(1);
    expect(reports(h)[0]?.body).toEqual({
      state: "PROTECTED",
      policyVersion: 1,
      checks: [
        { id: "policy_signature", status: "PASS" },
        { id: "rules_installed", status: "PASS" },
        { id: "private_windows", status: "PASS" },
        { id: "site_access", status: "PASS" },
        { id: "sync_fresh", status: "PASS" },
        { id: "safe_browsing", status: "PASS" },
        { id: "force_installed", status: "NOT_CONFIGURED" },
      ],
    });
    const s = await h.service.getStatus();
    expect(s.checks).toHaveLength(7);
    expect(s.lastHealthCheckAt).toBe(new Date(NOW).toISOString());
  });

  it("aren't repeated while nothing changes, but are when something does, and at least hourly", async () => {
    const h = await paired();
    await h.service.reportHealth();
    expect(reports(h)).toHaveLength(1);

    h.setPrivateWindows(false);
    await h.service.reportHealth();
    expect(reports(h)).toHaveLength(2);
    const second = reports(h)[1]?.body as { state: string; checks: { id: string; status: string }[] };
    expect(second.state).toBe("NEEDS_ATTENTION");
    expect(second.checks).toContainEqual({ id: "private_windows", status: "WARNING" });

    const last = (await h.state.health.get())!;
    await h.state.health.set({ ...last, lastReportAt: new Date(NOW - 61 * 60_000).toISOString() });
    await h.service.reportHealth();
    expect(reports(h)).toHaveLength(3);
  });

  it("a parent's Run health check always reports", async () => {
    const h = await paired();
    await h.service.runHealthCheck();
    expect(reports(h)).toHaveLength(2);
  });

  it("one that couldn't be sent goes on the next check", async () => {
    const h = await paired({ [HEALTH]: [() => "network-error", accepted] });
    const first = await h.state.health.get();
    expect(first?.lastCheckAt).toBe(new Date(NOW).toISOString());
    expect(first?.lastReportAt).toBeUndefined();
    await h.service.reportHealth();
    expect(reports(h)).toHaveLength(2);
    expect((await h.state.health.get())?.lastReportAt).toBe(new Date(NOW).toISOString());
  });

  it("a report refused because the browser was removed forgets the connection", async () => {
    const h = await paired({
      [HEALTH]: [accepted, () => ({ status: 401, json: { error: "gone" } })],
      "/api/browser/v1/token": () => ({ status: 401, json: { error: "gone", code: "installation_revoked" } }),
    });
    await h.service.runHealthCheck();
    expect(await h.state.installation.get()).toBeNull();
    expect(await h.state.health.get()).toBeNull();
  });
});

describe("Safe Browsing (Chrome)", () => {
  it("is held on while the family asks for it, and handed back when they don't", async () => {
    const h = await paired();
    expect(h.safeBrowsing).toEqual({ value: true, level: "controlled_by_this_extension" });

    const off = await paired({}, undefined, { ...policy(1), safeBrowsing: false });
    expect(off.safeBrowsing?.level).toBe("controllable_by_this_extension");
    expect((await off.service.getStatus()).checks.find((c) => c.id === "safe_browsing")?.status).toBe(
      "NOT_CONFIGURED",
    );
  });

  it("turned off by another extension: needs a parent, and the popup says so", async () => {
    const h = await paired();
    const sb = h.safeBrowsing;
    if (!sb) throw new Error("Chrome has Safe Browsing");
    Object.assign(sb, { value: false, level: "controlled_by_other_extensions" });
    await h.service.enforce(); // can't take it back
    const s = await h.service.getStatus();
    expect(s.state).toBe("NEEDS_ATTENTION");
    expect(s.issues.map((i) => i.id)).toEqual(["safe-browsing"]);
    expect(s.issues[0]?.detail).toMatch(/Another extension/);
  });

  it("switched off while eGuard held it: put back on", async () => {
    const h = await paired();
    if (h.safeBrowsing) h.safeBrowsing.value = false;
    await h.service.enforce();
    expect(h.safeBrowsing?.value).toBe(true);
  });
});

describe("Firefox", () => {
  it("is protected without claiming Safe Browsing it can't check", async () => {
    const h = await paired({}, FIREFOX);
    const s = await h.service.getStatus();
    expect(s.state).toBe("PROTECTED");
    expect(s.checks.find((c) => c.id === "safe_browsing")?.status).toBe("UNSUPPORTED");
  });
});

describe("daily counts", () => {
  const today = dayIn(undefined, new Date(NOW));
  const daysAgo = (n: number) => dayIn(undefined, new Date(NOW - n * 864e5));

  it("count blocked pages per category or reason, and never keep a site", async () => {
    const h = await paired();
    await h.service.onNavigationError(1, "https://adult.example/x");
    await h.service.onNavigationError(2, "https://www.example.com/a");
    await h.service.onNavigationError(3, "https://www.example.com/b");
    await h.service.onNavigationError(4, "https://allowed.example.org/"); // not blocked: not counted
    expect(await h.state.blockCounts.get()).toEqual({ [today]: { ADULT: 1, BLOCKED_SITE: 2 } });
    // Only the policy itself names sites; nothing eGuard writes about browsing does
    const { policy: _policy, ...rest } = h.local.dump();
    expect(JSON.stringify({ ...rest, session: h.session.dump() })).not.toMatch(/example/);
  });

  it("show today's counts in the popup, and only today's", async () => {
    const h = await paired();
    await h.state.blockCounts.set({ [daysAgo(1)]: { GAMING: 4 } });
    await h.service.onNavigationError(1, "https://adult.example/x");
    const s = await h.service.getStatus();
    expect(s.policySummary?.blockedToday).toEqual({ ADULT: 1 });
    expect(JSON.stringify(s)).not.toMatch(/example/);
  });

  it("send finished days only, and forget what eGuard took or refused", async () => {
    const h = await paired({
      [EVENTS]: [
        () => ({ status: 200, json: { ok: true } }),
        () => ({ status: 400, json: { error: "old" } }),
      ],
    });
    await h.state.blockCounts.set({
      [daysAgo(2)]: { GAMING: 3 },
      [daysAgo(1)]: { ADULT: 1 },
      [today]: { GAMING: 1 },
    });
    await h.service.sendDailyCounts();
    expect(h.calls.filter((c) => c.path === EVENTS).map((c) => c.body)).toEqual([
      { date: daysAgo(2), blocked: { GAMING: 3 } },
      { date: daysAgo(1), blocked: { ADULT: 1 } },
    ]);
    expect(await h.state.blockCounts.get()).toEqual({ [today]: { GAMING: 1 } });
  });

  it("keep a day eGuard couldn't be reached for, and drop ones too old to send", async () => {
    const h = await paired({ [EVENTS]: () => "network-error" });
    await h.state.blockCounts.set({
      [daysAgo(KEEP_COUNTS_DAYS + 1)]: { GAMING: 9 },
      [daysAgo(1)]: { ADULT: 1 },
    });
    await h.service.sendDailyCounts();
    expect(await h.state.blockCounts.get()).toEqual({ [daysAgo(1)]: { ADULT: 1 } });
  });

  it("are forgotten with the connection", async () => {
    const h = await paired();
    await h.service.onNavigationError(1, "https://adult.example/x");
    await h.state.forgetInstallation();
    expect(await h.state.blockCounts.get()).toBeNull();
  });
});
