import { describe, expect, it } from "vitest";
import { BrowserProtectionPolicy, Domain, ExtensionMessage, MessageResponse, PairingCode } from "./index.ts";

describe("ExtensionMessage", () => {
  it("accepts every known message", () => {
    for (const m of [
      { type: "GET_PROTECTION_STATUS" },
      { type: "RUN_HEALTH_CHECK" },
      { type: "SYNC_POLICY" },
      { type: "OPEN_PARENT_DASHBOARD" },
      { type: "OPEN_ONBOARDING" },
      { type: "PAIR_WITH_CODE", code: "824917" },
      { type: "REQUEST_ACCESS", url: "https://example.com/x", reason: "School project" },
      { type: "GET_BLOCK_INFO", url: "https://example.com/" },
      { type: "CONTINUE_TO_SITE", url: "http://example.com/" },
      { type: "CHECK_ACCESS", url: "https://example.com/" },
    ]) {
      expect(ExtensionMessage.safeParse(m).success, m.type).toBe(true);
    }
  });

  it("rejects unknown types and unknown fields", () => {
    expect(ExtensionMessage.safeParse({ type: "DISABLE_PROTECTION" }).success).toBe(false);
    expect(ExtensionMessage.safeParse({ type: "SYNC_POLICY", force: true }).success).toBe(false);
    expect(ExtensionMessage.safeParse(null).success).toBe(false);
    expect(ExtensionMessage.safeParse("GET_PROTECTION_STATUS").success).toBe(false);
  });

  it("caps an access-request reason", () => {
    expect(
      ExtensionMessage.safeParse({ type: "REQUEST_ACCESS", url: "https://a.com/", reason: "x".repeat(281) })
        .success,
    ).toBe(false);
  });

  it("block-page messages only carry web addresses", () => {
    for (const url of ["javascript:alert(1)", "chrome://settings", "file:///etc/passwd", "not a url"]) {
      expect(ExtensionMessage.safeParse({ type: "CONTINUE_TO_SITE", url }).success, url).toBe(false);
    }
  });
});

describe("PairingCode", () => {
  it("normalises spaces, dashes and case", () => {
    expect(PairingCode.parse(" 824-917 ")).toBe("824917");
    expect(PairingCode.parse("ab12 cd")).toBe("AB12CD");
  });
  it("rejects codes that can't be valid", () => {
    for (const bad of ["", "12345", "82491<script>", "1234567890123"])
      expect(PairingCode.safeParse(bad).success, bad).toBe(false);
  });
});

describe("Domain", () => {
  it("accepts host names and lower-cases them", () => {
    expect(Domain.parse("WWW.Example.COM")).toBe("www.example.com");
    expect(Domain.parse("sub-domain.example.co.uk")).toBe("sub-domain.example.co.uk");
  });
  it("rejects URLs, ports, wildcards and single labels", () => {
    for (const bad of [
      "https://example.com",
      "example.com/path",
      "example.com:80",
      "*.example.com",
      "localhost",
      "-bad.com",
      "a..com",
    ]) {
      expect(Domain.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("BrowserProtectionPolicy", () => {
  const valid = {
    id: "pol_1",
    childId: "c1",
    installationId: "bi_1",
    version: 42,
    safeBrowsing: true,
    safeSearch: true,
    blockedCategories: ["ADULT", "GAMBLING"],
    blockedDomains: ["example.com"],
    allowedDomains: ["school.edu"],
    unknownSitesPolicy: "ALLOW",
    schedule: { enabled: true, startTime: "21:30", endTime: "06:00", timezone: "Asia/Manila" },
    temporaryAllows: [{ domain: "roblox.com", until: "2026-09-28T12:00:00Z" }],
    categoryDomains: { GAMING: ["roblox.com"] },
    updatedAt: "2026-09-28T10:30:00Z",
  };
  it("accepts a well-formed policy", () => {
    expect(BrowserProtectionPolicy.safeParse(valid).success).toBe(true);
  });
  it("rejects malformed policies", () => {
    expect(BrowserProtectionPolicy.safeParse({ ...valid, version: 0 }).success).toBe(false);
    expect(BrowserProtectionPolicy.safeParse({ ...valid, blockedCategories: ["NOPE"] }).success).toBe(false);
    expect(BrowserProtectionPolicy.safeParse({ ...valid, blockedDomains: ["not a domain"] }).success).toBe(
      false,
    );
    expect(
      BrowserProtectionPolicy.safeParse({ ...valid, schedule: { ...valid.schedule, startTime: "25:00" } })
        .success,
    ).toBe(false);
    const { safeSearch: _omit, ...missing } = valid;
    expect(BrowserProtectionPolicy.safeParse(missing).success).toBe(false);
  });
});

describe("MessageResponse", () => {
  it("requires an error code and text on failure", () => {
    expect(MessageResponse.safeParse({ ok: false, error: "x" }).success).toBe(false);
    expect(MessageResponse.safeParse({ ok: false, error: "x", code: "Y" }).success).toBe(true);
  });
});
