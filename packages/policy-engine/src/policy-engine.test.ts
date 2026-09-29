import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BrowserProtectionPolicy } from "@eguard/schemas";
import {
  canonicalJson,
  domainCovers,
  evaluateUrl,
  httpHost,
  importPolicyKey,
  isScheduleActive,
  matchDomain,
  minutesInZone,
  verifyPolicySignature,
} from "./index.ts";

/** Same vector as ~/eguard/tests/api/browser-policy.test.ts: the signer and verifier must agree byte for byte. */
export const CANONICAL_VECTOR = {
  input: { b: [3, { z: 1, a: "x" }], a: null, c: { y: true, x: "é" } },
  output: '{"a":null,"b":[3,{"a":"x","z":1}],"c":{"x":"é","y":true}}',
};

const policy = (p: Partial<BrowserProtectionPolicy> = {}): BrowserProtectionPolicy => ({
  id: "pol_1",
  childId: "c1",
  installationId: "bi_1",
  version: 3,
  safeBrowsing: true,
  safeSearch: true,
  blockedCategories: ["ADULT", "GAMING"],
  blockedDomains: ["blocked.example", "ads.tracker.example"],
  allowedDomains: ["school.example", "games.school.example"],
  unknownSitesPolicy: "ALLOW",
  schedule: null,
  temporaryAllows: [],
  categoryDomains: {},
  updatedAt: "2026-09-29T10:00:00.000Z",
  ...p,
});

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const signFor = (v: unknown) =>
    sign("sha256", Buffer.from(canonicalJson(v)), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString(
      "base64",
    );
  return { spki, signFor };
}

describe("canonicalJson", () => {
  it("sorts keys at every level, keeps array order, no whitespace", () => {
    expect(canonicalJson(CANONICAL_VECTOR.input)).toBe(CANONICAL_VECTOR.output);
  });
});

describe("policy signatures", () => {
  it("accepts eGuard's signature (as Node signs it on the server)", async () => {
    const k = keys();
    const p = policy();
    expect(await verifyPolicySignature(await importPolicyKey(k.spki), p, k.signFor(p))).toBe(true);
  });

  it("is independent of key order in the received JSON", async () => {
    const k = keys();
    const p = policy();
    const reordered = Object.fromEntries(Object.entries(p).reverse());
    expect(await verifyPolicySignature(await importPolicyKey(k.spki), reordered, k.signFor(p))).toBe(true);
  });

  it("rejects any edit, another key, and malformed signatures", async () => {
    const k = keys();
    const key = await importPolicyKey(k.spki);
    const p = policy();
    const sig = k.signFor(p);
    expect(await verifyPolicySignature(key, { ...p, blockedDomains: [] }, sig)).toBe(false);
    expect(await verifyPolicySignature(key, { ...p, version: 4 }, sig)).toBe(false);
    expect(await verifyPolicySignature(key, p, keys().signFor(p))).toBe(false);
    expect(await verifyPolicySignature(key, p, "")).toBe(false);
    expect(await verifyPolicySignature(key, p, "not base64!")).toBe(false);
    expect(await verifyPolicySignature(key, p, btoa("x".repeat(64)))).toBe(false);
  });
});

describe("domains", () => {
  it("extracts hosts only from web URLs", () => {
    expect(httpHost("https://WWW.Example.com./path?q=1")).toBe("www.example.com");
    expect(httpHost("http://localhost:3000/")).toBe("localhost");
    expect(httpHost("chrome://settings")).toBeNull();
    expect(httpHost("file:///C:/x.html")).toBeNull();
    expect(httpHost("not a url")).toBeNull();
  });

  it("covers subdomains but not look-alikes", () => {
    expect(domainCovers("example.com", "example.com")).toBe(true);
    expect(domainCovers("example.com", "a.b.example.com")).toBe(true);
    expect(domainCovers("example.com", "notexample.com")).toBe(false);
    expect(domainCovers("example.com", "example.com.evil.net")).toBe(false);
  });

  it("prefers the most specific rule", () => {
    expect(matchDomain("games.school.example", ["school.example", "games.school.example"])).toBe(
      "games.school.example",
    );
    expect(matchDomain("other.example", ["school.example"])).toBeNull();
  });
});

describe("focus hours", () => {
  const manila = (hhmm: string) => new Date(`2026-09-29T${hhmm}:00+08:00`);
  const overnight = { enabled: true, startTime: "21:00", endTime: "06:00", timezone: "Asia/Manila" };

  it("reads the time in the family's time zone", () => {
    expect(minutesInZone(manila("21:30"), "Asia/Manila")).toBe(21 * 60 + 30);
    expect(minutesInZone(manila("21:30"), "UTC")).toBe(13 * 60 + 30);
  });

  it("handles overnight windows (start inclusive, end exclusive)", () => {
    expect(isScheduleActive(overnight, manila("20:59"))).toBe(false);
    expect(isScheduleActive(overnight, manila("21:00"))).toBe(true);
    expect(isScheduleActive(overnight, manila("02:00"))).toBe(true);
    expect(isScheduleActive(overnight, manila("06:00"))).toBe(false);
  });

  it("handles same-day windows, and is off when disabled, empty or absent", () => {
    const homework = { enabled: true, startTime: "15:00", endTime: "17:00", timezone: "Asia/Manila" };
    expect(isScheduleActive(homework, manila("16:00"))).toBe(true);
    expect(isScheduleActive(homework, manila("17:00"))).toBe(false);
    expect(isScheduleActive({ ...homework, enabled: false }, manila("16:00"))).toBe(false);
    expect(isScheduleActive({ ...homework, endTime: "15:00" }, manila("15:00"))).toBe(false);
    expect(isScheduleActive(null, manila("16:00"))).toBe(false);
  });

  it("falls back to UTC for an unknown zone instead of throwing", () => {
    expect(
      isScheduleActive({ ...overnight, timezone: "Mars/Olympus" }, new Date("2026-09-29T22:00:00Z")),
    ).toBe(true);
  });
});

describe("evaluateUrl", () => {
  const now = new Date("2026-09-29T12:00:00+08:00");
  const categoryOf = (host: string) =>
    host.endsWith("casino.example") ? "GAMBLING" : host.endsWith("play.example") ? "GAMING" : null;

  it("leaves browser pages alone", () => {
    expect(evaluateUrl(policy(), "chrome://extensions", { now }).decision).toBe("ALLOW");
  });

  it("allowed sites win, even inside a blocked site or category", () => {
    const p = policy({ blockedDomains: ["school.example"], allowedDomains: ["games.school.example"] });
    expect(evaluateUrl(p, "https://games.school.example/", { now })).toMatchObject({
      decision: "ALLOW",
      reason: { type: "ALLOWED_SITE" },
    });
    expect(evaluateUrl(p, "https://school.example/", { now }).decision).toBe("BLOCK");
  });

  it("blocks listed sites and their subdomains", () => {
    expect(evaluateUrl(policy(), "https://m.blocked.example/x", { now })).toMatchObject({
      decision: "BLOCK",
      host: "m.blocked.example",
      reason: { type: "BLOCKED_SITE", domain: "blocked.example" },
    });
  });

  it("blocks only categories the family blocked", () => {
    expect(evaluateUrl(policy(), "https://play.example/", { now, categoryOf })).toMatchObject({
      decision: "BLOCK",
      reason: { type: "CATEGORY", category: "GAMING" },
    });
    expect(evaluateUrl(policy(), "https://casino.example/", { now, categoryOf }).decision).toBe("ALLOW");
  });

  it("applies the other-websites rule, and focus hours block everything not allowed", () => {
    expect(
      evaluateUrl(policy({ unknownSitesPolicy: "WARN" }), "https://news.example/", { now }).decision,
    ).toBe("WARN");
    expect(
      evaluateUrl(policy({ unknownSitesPolicy: "BLOCK" }), "https://news.example/", { now }).decision,
    ).toBe("BLOCK");
    const focus = policy({
      schedule: { enabled: true, startTime: "11:00", endTime: "13:00", timezone: "Asia/Manila" },
    });
    expect(evaluateUrl(focus, "https://news.example/", { now })).toMatchObject({
      decision: "BLOCK",
      reason: { type: "FOCUS_HOURS" },
    });
    expect(evaluateUrl(focus, "https://school.example/", { now }).decision).toBe("ALLOW");
  });
});
