import { describe, expect, it } from "vitest";
import type { Handler } from "@eguard/api-client/testing";
import { exactHostFilter } from "./enforcement.ts";
import { MANUAL_LIMITS, REQUESTS_FRESH_MS } from "./service.ts";
import { harness, pairOk, policy, removedAnswer, signFor, signed, tok, tokenOk } from "./test-harness.ts";

const PAIR = "/api/browser/v1/pair";
const POLICY = "/api/browser/v1/policy";
const TOKEN = "/api/browser/v1/token";
/** What /token answers once a parent removed the browser: eGuard's signed revocation. */
const revoked: Handler = () => removedAnswer();

describe("pairing", () => {
  it("stores credentials, downloads the first policy, and never stores a password", async () => {
    const h = harness({ [PAIR]: pairOk, [POLICY]: () => ({ status: 200, json: signed(policy(1)) }) });
    await h.service.pairWithCode("824917");

    expect(h.calls[0]?.body).toEqual({
      code: "824917",
      browser: "Chrome",
      browserVersion: "153.0.0.0",
      extensionVersion: "0.1.0",
      platform: "win",
    });
    expect(h.calls[1]?.headers.Authorization).toBe(`Bearer ${tok("at0")}`);
    expect(h.local.dump()).toMatchObject({
      credential: { installationId: "bi_1", refreshToken: tok("rt0") },
      installation: { childName: "Mia", familyName: "Cruz family" },
      policy: { policy: { version: 1 } },
    });
    // Access token lives in session storage only
    expect(h.local.dump()).not.toHaveProperty("access");
    expect(h.session.dump()).toHaveProperty("access");
    expect(JSON.stringify(h.local.dump())).not.toMatch(/password/i);

    const s = await h.service.getStatus();
    expect(s.connection).toMatchObject({ paired: true, childName: "Mia" });
    // Signed policy verified, rules installed and read back, private windows allowed
    expect(s.state).toBe("PROTECTED");
  });

  it("stays paired when the first policy download fails", async () => {
    const h = harness({ [PAIR]: pairOk, [POLICY]: () => "network-error" });
    await h.service.pairWithCode("824917");
    const s = await h.service.getStatus();
    expect(s.connection.paired).toBe(true);
    expect(s.state).toBe("ACTION_REQUIRED");
    expect(s.summary).toMatch(/couldn't download/);
  });

  it("passes the server's reason through for a bad code", async () => {
    const h = harness({
      [PAIR]: () => ({ status: 400, json: { error: "Pairing code is invalid or expired" } }),
    });
    await expect(h.service.pairWithCode("000000")).rejects.toMatchObject({
      code: "PAIRING_REJECTED",
      message: "Pairing code is invalid or expired",
    });
    expect((await h.service.getStatus()).connection.paired).toBe(false);
  });

  it("refuses to re-pair an already connected browser (a child can't move it to another account)", async () => {
    const h = harness({ [PAIR]: pairOk, [POLICY]: () => ({ status: 200, json: signed(policy(1)) }) });
    await h.service.pairWithCode("824917");
    await expect(h.service.pairWithCode("111111")).rejects.toMatchObject({ code: "ALREADY_PAIRED" });
    expect(h.calls.filter((c) => c.path === PAIR)).toHaveLength(1);
  });

  it("pairs once when two codes are sent at the same moment", async () => {
    const h = harness({ [PAIR]: pairOk, [POLICY]: () => ({ status: 200, json: signed(policy(1)) }) });
    const results = await Promise.allSettled([
      h.service.pairWithCode("824917"),
      h.service.pairWithCode("111111"),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(h.calls.filter((c) => c.path === PAIR)).toHaveLength(1);
  });
});

describe("policy sync", () => {
  async function paired(policyRoutes: Handler | Handler[]) {
    const h = harness({ [PAIR]: pairOk, [POLICY]: policyRoutes, [TOKEN]: revoked });
    await h.service.pairWithCode("824917");
    return h;
  }

  it("moves forward to newer versions", async () => {
    const h = await paired([
      () => ({ status: 200, json: signed(policy(1)) }),
      () => ({ status: 200, json: signed(policy(2)) }),
    ]);
    await h.service.syncPolicy();
    expect((await h.state.policy.get())?.policy.version).toBe(2);
  });

  it("refuses a lower version (rollback) and keeps the current policy", async () => {
    const h = await paired([
      () => ({ status: 200, json: signed(policy(5)) }),
      () => ({ status: 200, json: signed(policy(3)) }),
    ]);
    await h.service.syncPolicy();
    expect((await h.state.policy.get())?.policy.version).toBe(5);
    expect((await h.state.sync.get())?.lastError?.kind).toBe("refused");
    expect(h.log).toHaveBeenCalledWith(
      "policy_rejected",
      expect.objectContaining({ why: "version_rollback" }),
    );
  });

  it("refuses a policy addressed to another installation", async () => {
    const h = await paired([
      () => ({ status: 200, json: signed(policy(1)) }),
      () => ({ status: 200, json: signed(policy(9, "bi_other")) }),
    ]);
    await h.service.syncPolicy();
    expect((await h.state.policy.get())?.policy.version).toBe(1);
  });

  it("refuses a malformed policy", async () => {
    const h = await paired([
      () => ({ status: 200, json: signed(policy(1)) }),
      () => ({ status: 200, json: signed({ ...policy(2), blockedDomains: ["<script>"] }) }),
    ]);
    await h.service.syncPolicy();
    expect((await h.state.policy.get())?.policy.version).toBe(1);
  });

  it("accepts a signed policy carrying fields this build doesn't know yet, and keeps verifying it", async () => {
    const newer = {
      ...policy(2),
      futureSwitch: true,
      schedule: { enabled: false, startTime: "21:00", endTime: "06:00", timezone: "Asia/Manila", days: [1] },
    };
    const h = await paired([
      () => ({ status: 200, json: signed(policy(1)) }),
      () => ({ status: 200, json: signed(newer) }),
    ]);
    await h.service.syncPolicy();
    expect((await h.state.policy.get())?.policy.version).toBe(2);
    // Read back from storage, the signature still matches (nothing was stripped)
    expect((await h.service.getStatus()).policyVersion).toBe(2);
  });

  it("keeps the last policy active while offline", async () => {
    const h = await paired([() => ({ status: 200, json: signed(policy(4)) }), () => "network-error"]);
    await h.service.syncPolicy();
    expect((await h.state.policy.get())?.policy.version).toBe(4);
    expect((await h.state.sync.get())?.lastError?.kind).toBe("network");
  });

  it("forgets the installation when the parent removes this browser", async () => {
    const h = await paired([() => ({ status: 200, json: signed(policy(1)) }), () => ({ status: 401 })]);
    await h.service.syncPolicy();
    expect(h.local.dump()).toEqual({});
    expect((await h.service.getStatus()).connection.paired).toBe(false);
  });

  it("keeps protecting through an unexplained 401, and says it couldn't sync", async () => {
    const h = harness({
      [PAIR]: pairOk,
      [POLICY]: [() => ({ status: 200, json: signed(policy(1)) }), () => ({ status: 401 })],
      [TOKEN]: () => ({ status: 401, json: { error: "Not connected", code: "unauthorized" } }),
    });
    await h.service.pairWithCode("824917");
    await h.service.syncPolicy();
    const s = await h.service.getStatus();
    expect(s.connection.paired).toBe(true);
    expect(s.policyVersion).toBe(1);
    expect(h.browserRules.dynamic.length).toBeGreaterThan(0);
    expect((await h.state.sync.get())?.lastError?.kind).toBe("unauthorized");
  });

  it("requires a connection", async () => {
    await expect(harness().service.syncPolicy()).rejects.toMatchObject({ code: "NOT_CONNECTED" });
  });
});

describe("health check and navigation", () => {
  it("stamps the check time even when not connected", async () => {
    const h = harness();
    await h.service.runHealthCheck();
    expect((await h.service.getStatus()).lastHealthCheckAt).toBe("2026-09-29T10:00:00.000Z");
  });

  it("opens the parent dashboard on the configured web app", async () => {
    const h = harness();
    await h.service.openDashboard();
    expect(h.openTab).toHaveBeenCalledWith("https://app.test/dashboard");
  });
});

describe("policy signatures", () => {
  const paired = async (routes: Handler[]) => {
    const h = harness({ [PAIR]: pairOk, [POLICY]: routes });
    await h.service.pairWithCode("824917");
    return h;
  };

  it("refuses a policy eGuard didn't sign, or one changed after signing", async () => {
    const forged = { ...policy(2), blockedDomains: [] };
    const h = await paired([
      () => ({ status: 200, json: signed(policy(1)) }),
      () => ({ status: 200, json: { policy: forged, signature: signFor(policy(2)), keyId: "testkey" } }),
      () => ({ status: 200, json: { policy: policy(3), signature: "", keyId: "testkey" } }),
    ]);
    await h.service.syncPolicy();
    expect((await h.state.policy.get())?.policy.version).toBe(1);
    expect(h.log).toHaveBeenCalledWith("policy_rejected", expect.objectContaining({ why: "bad_signature" }));
    await h.service.syncPolicy();
    expect((await h.state.policy.get())?.policy.version).toBe(1);
  });

  it("discards a stored policy edited in the browser, and downloads a genuine one again", async () => {
    const h = await paired([
      () => ({ status: 200, json: signed(policy(4)) }),
      () => ({ status: 200, json: signed(policy(4)) }),
    ]);
    const stored = (await h.state.policy.get())!;
    // e.g. someone with developer tools empties the blocked list
    await h.state.policy.set({ ...stored, policy: { ...stored.policy, blockedDomains: [] } });

    const rulesBefore = structuredClone(h.browserRules.dynamic);
    const s = await h.service.getStatus();
    expect(s.policyVersion).toBeNull();
    expect(s.state).toBe("ACTION_REQUIRED");
    expect(await h.state.policy.get()).toBeNull();
    expect(h.log).toHaveBeenCalledWith("stored_policy_invalid", { version: 4 });
    // The rules from the last verified policy stay until a genuine one arrives: tampering never unblocks
    expect(await h.service.enforce()).toBe(false);
    expect(h.browserRules.dynamic).toEqual(rulesBefore);

    await h.service.syncPolicy();
    expect((await h.service.getStatus()).policyVersion).toBe(4);
    expect((await h.state.policy.get())?.policy.blockedDomains).toEqual(["example.com"]);
  });

  it("still refuses an older version after the stored policy was discarded", async () => {
    const h = await paired([
      () => ({ status: 200, json: signed(policy(4)) }),
      () => ({ status: 200, json: signed(policy(2)) }),
    ]);
    const stored = (await h.state.policy.get())!;
    await h.state.policy.set({ ...stored, signature: signFor(policy(9)) }); // no longer verifies
    expect((await h.service.getStatus()).policyVersion).toBeNull();
    await h.service.syncPolicy();
    expect(await h.state.policy.get()).toBeNull();
    expect(h.log).toHaveBeenCalledWith(
      "policy_rejected",
      expect.objectContaining({ why: "version_rollback" }),
    );
  });

  it("takes a same-version policy whose content changed (new category lists), and ignores an identical one", async () => {
    const newer = { ...policy(1), categoryDomains: { ADULT: ["adult.example", "more.example"] } };
    const h = await paired([
      () => ({ status: 200, json: signed(policy(1)) }),
      () => ({ status: 200, json: signed(policy(1)) }),
      () => ({ status: 200, json: signed(newer) }),
    ]);
    const first = await h.state.policy.get();
    await h.service.syncPolicy();
    expect(await h.state.policy.get()).toEqual(first);
    await h.service.syncPolicy();
    expect((await h.state.policy.get())?.policy.categoryDomains).toEqual(newer.categoryDomains);
    expect(
      h.browserRules.dynamic.some(
        (r) => r.action.type === "block" && r.condition.requestDomains?.includes("more.example"),
      ),
    ).toBe(true);
  });

  it("summarises the verified policy for the popup: counts and switches, never site names", async () => {
    const withFocus = {
      ...policy(2),
      allowedDomains: ["school.example", "khanacademy.org"],
      unknownSitesPolicy: "WARN",
      schedule: { enabled: true, startTime: "21:00", endTime: "06:00", timezone: "UTC" },
      youtubeRestrict: "MODERATE",
    };
    const h = await paired([() => ({ status: 200, json: signed(withFocus) })]);
    const s = await h.service.getStatus();
    // The signed field reaches the browser's rules as the Restricted Mode header
    expect(h.browserRules.dynamic.find((r) => r.action.type === "modifyHeaders")?.action).toMatchObject({
      requestHeaders: [{ header: "YouTube-Restrict", value: "Moderate" }],
    });
    expect(s.policySummary).toEqual({
      safeSearch: true,
      safeBrowsing: true,
      youtubeRestrict: "MODERATE",
      blockedCategories: 1,
      categories: policy(2).blockedCategories,
      blockedToday: {},
      blockedSites: 1,
      allowedSites: 2,
      otherSites: "WARN",
      focusHours: { startTime: "21:00", endTime: "06:00", activeNow: false },
    });
    expect(JSON.stringify(s)).not.toContain("school.example");
  });
});

describe("enforcement", () => {
  const ACCESS = "/api/browser/v1/access-requests";
  const pairedWith = async (policies: object[], extra: Record<string, Handler | Handler[]> = {}) => {
    const h = harness({
      [PAIR]: pairOk,
      [POLICY]: policies.map((p) => () => ({ status: 200, json: signed(p) })),
      ...extra,
    });
    await h.service.pairWithCode("824917");
    return h;
  };
  const blocking = (h: Awaited<ReturnType<typeof pairedWith>>) =>
    h.browserRules.dynamic
      .filter((r) => r.action.type === "block")
      .flatMap((r) => r.condition.requestDomains ?? []);

  it("installs the policy's rules and verifies them by reading them back", async () => {
    const h = await pairedWith([policy(1)]);
    expect(blocking(h)).toEqual(["example.com", "adult.example"]);
    expect(h.browserRules.dynamic.find((r) => r.action.type === "allow")?.condition.requestDomains).toEqual([
      "app.test",
    ]);
    expect((await h.service.getStatus()).state).toBe("PROTECTED");
  });

  it("notices rules removed behind its back, says so, and puts them back", async () => {
    const h = await pairedWith([policy(1)]);
    h.browserRules.dynamic = h.browserRules.dynamic.filter(
      (r) => r.action.type !== "block" || !r.condition.requestDomains?.includes("example.com"),
    );
    const s = await h.service.getStatus();
    expect(s.state).toBe("ACTION_REQUIRED");
    expect(s.issues[0]?.id).toBe("rules-not-active");
    await h.service.enforce();
    expect((await h.service.getStatus()).state).toBe("PROTECTED");
  });

  it("isn't PROTECTED when private windows aren't allowed", async () => {
    const h = await pairedWith([policy(1)]);
    h.setPrivateWindows(false);
    expect((await h.service.getStatus()).issues[0]?.id).toBe("private-windows");
  });

  it("isn't PROTECTED when site access was withdrawn in the browser's settings", async () => {
    const h = await pairedWith([policy(1)]);
    h.setHostAccess(false);
    const s = await h.service.getStatus();
    expect(s.state).toBe("NEEDS_ATTENTION");
    expect(s.issues.map((i) => i.id)).toEqual(["site-access"]);
    h.setHostAccess(true);
    expect((await h.service.getStatus()).state).toBe("PROTECTED");
  });

  it("enforces a category or 'other websites' mode newer than this build, strictly", async () => {
    const h = await pairedWith([
      {
        ...policy(1),
        blockedCategories: ["ADULT", "AI_CHAT"],
        categoryDomains: { ADULT: ["adult.example"], AI_CHAT: ["chat.example"] },
        unknownSitesPolicy: "ASK_FIRST",
      },
    ]);
    expect((await h.service.getStatus()).policyVersion).toBe(1);
    expect(await h.service.blockInfo("https://chat.example/")).toMatchObject({
      decision: "BLOCK",
      reason: { type: "CATEGORY", category: "AI_CHAT" },
    });
    expect((await h.service.blockInfo("https://news.example.org/")).decision).toBe("BLOCK");
    expect((await h.service.getStatus()).policySummary?.otherSites).toBe("BLOCK");
  });

  it("counts every block, even when they're reported at the same moment", async () => {
    const h = await pairedWith([policy(1)]);
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => h.service.onNavigationError(i, "https://www.example.com/")),
    );
    expect(Object.values((await h.state.blockCounts.get()) ?? {})).toEqual([{ BLOCKED_SITE: 5 }]);
  });

  it("removes every rule when the parent removes the browser", async () => {
    const h = await pairedWith([policy(1)]);
    await h.state.forgetInstallation();
    await h.service.enforce();
    expect(h.browserRules.dynamic).toEqual([]);
  });

  it("shows the block page only for loads eGuard blocked", async () => {
    const h = await pairedWith([policy(1)]);
    await h.service.onNavigationError(7, "https://www.example.com/page");
    await h.service.onNavigationError(8, "https://news.example.org/"); // a network error, not a block
    await h.service.onNavigationError(9, "chrome://settings/");
    expect(h.openBlockPage.mock.calls).toEqual([[7, "https://www.example.com/page"]]);
  });

  it("explains the reason from the verified policy", async () => {
    const h = await pairedWith([policy(1)]);
    expect(await h.service.blockInfo("https://www.example.com/")).toMatchObject({
      decision: "BLOCK",
      reason: { type: "BLOCKED_SITE" },
      childName: "Mia",
    });
    expect(await h.service.blockInfo("https://adult.example/")).toMatchObject({
      decision: "BLOCK",
      reason: { type: "CATEGORY", category: "ADULT" },
    });
    expect((await h.service.blockInfo("https://fine.example/")).decision).toBe("ALLOW");
  });

  it("lets a child continue past a warning for a while, never past a block", async () => {
    const h = await pairedWith([{ ...policy(1), unknownSitesPolicy: "WARN" }]);
    await expect(h.service.continueToSite("https://www.example.com/")).rejects.toMatchObject({
      code: "NOT_ALLOWED",
    });
    expect(h.browserRules.session).toEqual([]);

    await h.service.continueToSite("https://news.example.org/story");
    expect(h.browserRules.session).toMatchObject([
      {
        priority: 100,
        action: { type: "allow" },
        condition: { regexFilter: exactHostFilter("news.example.org") },
      },
    ]);
    expect(h.browserRules.session[0]?.condition.requestDomains).toBeUndefined();
    await h.service.onNavigationError(3, "https://news.example.org/story");
    expect(h.openBlockPage).not.toHaveBeenCalled();
  });

  it("keeps SafeSearch on a search engine the child continued to", async () => {
    const h = await pairedWith([{ ...policy(1), blockedDomains: [], unknownSitesPolicy: "WARN" }]);
    // Warned engines get no compiled redirect (it would skip the warning)
    expect(h.browserRules.dynamic.some((r) => r.action.type === "redirect")).toBe(false);
    await h.service.continueToSite("https://www.google.com/");
    const google = h.browserRules.session.find((r) => r.action.type === "redirect");
    expect(google?.condition.regexFilter).toContain("google\\.com");
    expect(google).toMatchObject({
      priority: 110,
      action: {
        redirect: {
          transform: { queryTransform: { addOrReplaceParams: [{ key: "safe", value: "active" }] } },
        },
      },
    });
    // Without SafeSearch, Continue adds the allow rule only
    const off = await pairedWith([{ ...policy(1), safeSearch: false, unknownSitesPolicy: "WARN" }]);
    await off.service.continueToSite("https://www.google.com/");
    expect(off.browserRules.session.map((r) => r.action.type)).toEqual(["allow"]);
  });

  it("opens only the exact site a child continued to, never its subdomains or a whole domain ending", async () => {
    const h = await pairedWith([{ ...policy(1), unknownSitesPolicy: "WARN" }]);
    // "com" is a host no list mentions, so it only warns; Continue must not open every .com site
    await h.service.continueToSite("http://com/");
    await h.service.continueToSite("https://news.example.org/");
    const filters = h.browserRules.session.map((r) => new RegExp(r.condition.regexFilter!));
    const opens = (url: string) => filters.some((re) => re.test(url));
    expect(opens("http://com/")).toBe(true);
    expect(opens("https://news.example.org/a?b#c")).toBe(true);
    expect(opens("https://news.example.org:8443/")).toBe(true);
    expect(opens("https://www.example.com/")).toBe(false); // blocked site, ends in .com
    expect(opens("https://games.news.example.org/")).toBe(false);
    expect(opens("https://news.example.org.evil.test/")).toBe(false);
    expect(opens("https://evil.test/?u=https://news.example.org/")).toBe(false);
  });

  it("ends a Continue as soon as the policy no longer just warns about that site", async () => {
    const h = await pairedWith([
      { ...policy(1), unknownSitesPolicy: "WARN" },
      { ...policy(2), unknownSitesPolicy: "WARN", blockedDomains: ["example.com", "news.example.org"] },
    ]);
    await h.service.continueToSite("https://news.example.org/");
    expect(h.browserRules.session).toHaveLength(1);
    await h.service.syncPolicy(); // the parent blocks it
    expect(h.browserRules.session).toEqual([]);
    await h.service.onNavigationError(4, "https://news.example.org/");
    expect(h.openBlockPage).toHaveBeenCalledWith(4, "https://news.example.org/");
  });

  it("asks a parent, and opens the site once a new policy allows it", async () => {
    const approved = {
      ...policy(2),
      temporaryAllows: [{ domain: "www.example.com", until: "2026-09-29T11:00:00Z" }],
    };
    const request = {
      id: "req_1",
      domain: "www.example.com",
      reason: "homework",
      status: "PENDING",
      duration: null,
      expiresAt: null,
      createdAt: "2026-09-29T10:00:00Z",
      decidedAt: null,
    };
    const h = await pairedWith([policy(1), approved], {
      [ACCESS]: [
        () => ({ status: 201, json: { request } }),
        () => ({ status: 200, json: { requests: [request] } }),
      ],
    });
    const asked = await h.service.requestAccess("https://www.example.com/page", "homework");
    expect(h.calls.find((c) => c.path === ACCESS)?.body).toEqual({
      domain: "www.example.com",
      reason: "homework",
    });
    expect(asked).toMatchObject({ decision: "BLOCK", request: { status: "PENDING" } });

    const after = await h.service.checkAccess("https://www.example.com/page");
    expect(after.decision).toBe("ALLOW");
    expect(
      h.browserRules.dynamic
        .filter((r) => r.action.type === "allow")
        .flatMap((r) => r.condition.requestDomains ?? []),
    ).toContain("www.example.com");
  });
});

describe("buttons pressed again and again", () => {
  const ACCESS = "/api/browser/v1/access-requests";
  const request = (o: object = {}) => ({
    id: "req_1",
    domain: "www.example.com",
    reason: null,
    status: "PENDING",
    duration: null,
    expiresAt: null,
    createdAt: "2026-09-29T09:00:00Z",
    decidedAt: null,
    ...o,
  });
  const list = (r: object) => () => ({ status: 200, json: { requests: [r] } });
  const policyReads = (h: ReturnType<typeof harness>) => h.calls.filter((c) => c.path === POLICY).length;
  const listReads = (h: ReturnType<typeof harness>) => h.calls.filter((c) => c.path === ACCESS).length;

  it("Sync now pressed over and over stops reaching eGuard for a while; the periodic sync never does", async () => {
    const h = harness({
      [PAIR]: pairOk,
      [POLICY]: () => ({ status: 200, json: signed(policy(1)) }),
      [TOKEN]: tokenOk,
    });
    await h.service.pairWithCode("824917");
    const { max, windowMs } = MANUAL_LIMITS.sync;
    for (let i = 0; i < max; i++) await h.service.syncNow();
    expect(policyReads(h)).toBe(1 + max);
    await expect(h.service.syncNow()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // Check again on a block page counts the same way
    await h.service.checkAccess("https://www.example.com/");
    expect(policyReads(h)).toBe(1 + max);
    await h.service.periodic();
    expect(policyReads(h)).toBe(2 + max);

    h.advance(windowMs);
    await h.service.syncNow();
    expect(policyReads(h)).toBe(3 + max);
  });

  it("Check again right after a parent's answer fetches the policy at once", async () => {
    const approved = {
      ...policy(2),
      temporaryAllows: [{ domain: "www.example.com", until: "2026-09-29T11:00:00Z" }],
    };
    const h = harness({
      [PAIR]: pairOk,
      [POLICY]: [policy(1), approved].map((p) => () => ({ status: 200, json: signed(p) })),
      [ACCESS]: list(request({ status: "APPROVED", duration: "1H", decidedAt: "2026-09-29T10:00:02Z" })),
    });
    await h.service.pairWithCode("824917");
    for (let i = 0; i < MANUAL_LIMITS.sync.max; i++) await h.service.syncNow().catch(() => {});
    h.advance(3_000); // presses used up, but the answer came after the last sync
    const after = await h.service.checkAccess("https://www.example.com/page");
    expect(after.decision).toBe("ALLOW");
  });

  it("block pages share one list of requests, and a refused read keeps the last answer", async () => {
    const h = harness({
      [PAIR]: pairOk,
      [POLICY]: () => ({ status: 200, json: signed(policy(1)) }),
      [ACCESS]: [list(request()), () => ({ status: 429, json: { error: "Too many requests." } })],
    });
    await h.service.pairWithCode("824917");
    const url = "https://www.example.com/page";
    await h.service.blockInfo(url);
    await h.service.blockInfo(url);
    expect(listReads(h)).toBe(1);

    h.advance(REQUESTS_FRESH_MS);
    const later = await h.service.blockInfo(url);
    expect(listReads(h)).toBe(2);
    // Still waiting for a parent, not "Ask a parent" again
    expect(later.request).toEqual({ status: "PENDING", duration: null });
  });
});
