import { describe, expect, it } from "vitest";
import type { Handler } from "@eguard/api-client/testing";
import { harness, pairOk, policy, signFor, signed, tok } from "./test-harness.ts";

const PAIR = "/api/browser/v1/pair";
const POLICY = "/api/browser/v1/policy";
const TOKEN = "/api/browser/v1/token";

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
});

describe("policy sync", () => {
  async function paired(policyRoutes: Handler | Handler[]) {
    const h = harness({ [PAIR]: pairOk, [POLICY]: policyRoutes, [TOKEN]: () => ({ status: 401 }) });
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
    expect((await h.state.sync.get())?.lastError?.kind).toBe("invalid_response");
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

    const s = await h.service.getStatus();
    expect(s.policyVersion).toBeNull();
    expect(s.state).toBe("ACTION_REQUIRED");
    expect(await h.state.policy.get()).toBeNull();
    expect(h.log).toHaveBeenCalledWith("stored_policy_invalid", { version: 4 });

    await h.service.syncPolicy();
    expect((await h.service.getStatus()).policyVersion).toBe(4);
    expect((await h.state.policy.get())?.policy.blockedDomains).toEqual(["example.com"]);
  });

  it("summarises the verified policy for the popup: counts and switches, never site names", async () => {
    const withFocus = {
      ...policy(2),
      allowedDomains: ["school.example", "khanacademy.org"],
      unknownSitesPolicy: "WARN",
      schedule: { enabled: true, startTime: "21:00", endTime: "06:00", timezone: "UTC" },
    };
    const h = await paired([() => ({ status: 200, json: signed(withFocus) })]);
    const s = await h.service.getStatus();
    expect(s.policySummary).toEqual({
      safeSearch: true,
      safeBrowsing: true,
      blockedCategories: 1,
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
    expect(s.state).toBe("NEEDS_ATTENTION");
    expect(s.issues[0]?.id).toBe("rules-not-active");
    await h.service.enforce();
    expect((await h.service.getStatus()).state).toBe("PROTECTED");
  });

  it("isn't PROTECTED when private windows aren't allowed", async () => {
    const h = await pairedWith([policy(1)]);
    h.setPrivateWindows(false);
    expect((await h.service.getStatus()).issues[0]?.id).toBe("private-windows");
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
      { priority: 100, action: { type: "allow" }, condition: { requestDomains: ["news.example.org"] } },
    ]);
    await h.service.onNavigationError(3, "https://news.example.org/story");
    expect(h.openBlockPage).not.toHaveBeenCalled();
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
    expect(h.browserRules.dynamic.find((r) => r.action.type === "allow")?.condition.requestDomains).toContain(
      "www.example.com",
    );
  });
});
