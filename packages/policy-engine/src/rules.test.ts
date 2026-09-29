import { describe, expect, it } from "vitest";
import type { BrowserProtectionPolicy } from "@eguard/schemas";
import {
  PRIORITY,
  categoryIndex,
  compileRules,
  evaluateUrl,
  domainCovers,
  httpHost,
  ruleFingerprint,
  sameRules,
  type DnrRule,
} from "./index.ts";

const NOW = new Date("2026-09-29T12:00:00+08:00");
const policy = (p: Partial<BrowserProtectionPolicy> = {}): BrowserProtectionPolicy => ({
  id: "pol_1",
  childId: "c1",
  installationId: "bi_1",
  version: 3,
  safeBrowsing: true,
  safeSearch: true,
  blockedCategories: ["GAMING", "SOCIAL_MEDIA"],
  blockedDomains: ["blocked.example", "google.com.ph"],
  allowedDomains: ["school.example", "games.school.example"],
  unknownSitesPolicy: "ALLOW",
  schedule: null,
  temporaryAllows: [],
  categoryDomains: {
    GAMING: ["play.example", "roblox.com"],
    SOCIAL_MEDIA: ["facebook.com"],
    ADULT: ["ignored.example"],
  },
  updatedAt: "2026-09-29T10:00:00.000Z",
  ...p,
});

/**
 * A minimal model of how the browser applies these rules to a top-level navigation: the matching rule with the
 * highest priority wins; at equal priority allow beats block beats redirect (Chrome's documented order).
 */
function browserDecision(rules: DnrRule[], url: string): "ALLOW" | "BLOCK" | "REDIRECT" {
  const host = httpHost(url);
  const rank = { allow: 3, block: 2, redirect: 1 } as const;
  const matches = rules.filter((r) => {
    if (!r.condition.resourceTypes.includes("main_frame") || !host) return false;
    if (r.condition.requestDomains) return r.condition.requestDomains.some((d) => domainCovers(d, host));
    if (r.condition.urlFilter === "|http") return /^https?:/.test(url);
    if (r.condition.regexFilter) return new RegExp(r.condition.regexFilter).test(url);
    return false;
  });
  if (!matches.length) return "ALLOW";
  const top = matches.sort(
    (a, b) => b.priority - a.priority || rank[b.action.type] - rank[a.action.type],
  )[0]!;
  return top.action.type === "block" ? "BLOCK" : top.action.type === "redirect" ? "REDIRECT" : "ALLOW";
}

describe("compileRules", () => {
  it("blocks sites and only the categories the family chose, with allowed sites on top", () => {
    const rules = compileRules(policy(), { now: NOW, alwaysAllow: ["www.eguard.family"] });
    const byPriority = (p: number) => rules.filter((r) => r.priority === p);
    expect(byPriority(PRIORITY.allow)[0]?.condition.requestDomains).toEqual([
      "games.school.example",
      "school.example",
      "www.eguard.family",
    ]);
    expect(byPriority(PRIORITY.site)[0]?.condition.requestDomains).toEqual([
      "blocked.example",
      "google.com.ph",
    ]);
    expect(byPriority(PRIORITY.category).map((r) => r.condition.requestDomains)).toEqual([
      ["play.example", "roblox.com"],
      ["facebook.com"],
    ]);
    expect(byPriority(PRIORITY.other)).toEqual([]);
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
  });

  it("adds a catch-all only for warn/allowed-only modes and during focus hours", () => {
    const catchAll = (p: BrowserProtectionPolicy, now = NOW) =>
      compileRules(p, { now }).filter((r) => r.priority === PRIORITY.other);
    expect(catchAll(policy({ unknownSitesPolicy: "WARN" }))).toHaveLength(1);
    expect(catchAll(policy({ unknownSitesPolicy: "BLOCK" }))).toHaveLength(1);
    const focus = policy({
      schedule: { enabled: true, startTime: "11:00", endTime: "13:00", timezone: "Asia/Manila" },
    });
    expect(catchAll(focus)).toHaveLength(1);
    expect(catchAll(focus, new Date("2026-09-29T14:00:00+08:00"))).toHaveLength(0);
  });

  it("enforces SafeSearch only on engines the child may open", () => {
    const engines = (p: BrowserProtectionPolicy) =>
      compileRules(p, { now: NOW })
        .filter((r) => r.action.type === "redirect")
        .map((r) => r.condition.regexFilter);
    // google.com.ph is blocked in the fixture: no redirect that could open it
    expect(engines(policy())).toHaveLength(3);
    expect(engines(policy()).join()).not.toContain("com\\.ph");
    expect(engines(policy({ safeSearch: false }))).toHaveLength(0);
    // Allowed-only mode: only engines on the allowed list get SafeSearch (and open)
    expect(engines(policy({ unknownSitesPolicy: "BLOCK" }))).toHaveLength(0);
    expect(engines(policy({ unknownSitesPolicy: "BLOCK", allowedDomains: ["bing.com"] }))).toEqual([
      "^https?://(www\\.)?bing\\.com/search\\?",
    ]);
  });

  it("drops expired approvals", () => {
    const p = policy({
      temporaryAllows: [
        { domain: "roblox.com", until: "2026-09-29T05:00:00Z" }, // 13:00 Manila, still on
        { domain: "facebook.com", until: "2026-09-29T03:00:00Z" }, // 11:00 Manila, over
      ],
    });
    const allow = compileRules(p, { now: NOW }).find((r) => r.priority === PRIORITY.allow);
    expect(allow?.condition.requestDomains).toContain("roblox.com");
    expect(allow?.condition.requestDomains).not.toContain("facebook.com");
  });

  it("the browser's decision matches evaluateUrl for every case (block page explanations are true)", () => {
    const policies = [
      policy(),
      policy({ unknownSitesPolicy: "WARN" }),
      policy({ unknownSitesPolicy: "BLOCK" }),
      policy({ schedule: { enabled: true, startTime: "11:00", endTime: "13:00", timezone: "Asia/Manila" } }),
      policy({ temporaryAllows: [{ domain: "roblox.com", until: "2026-09-29T05:00:00Z" }] }),
      policy({
        temporaryAllows: [{ domain: "blocked.example", until: "2026-09-29T05:00:00Z" }],
        unknownSitesPolicy: "BLOCK",
      }),
      policy({ blockedDomains: ["school.example"], allowedDomains: ["games.school.example"] }),
    ];
    const urls = [
      "https://school.example/",
      "https://games.school.example/x",
      "https://blocked.example/",
      "https://m.blocked.example/",
      "https://roblox.com/",
      "https://www.roblox.com/home",
      "https://m.facebook.com/",
      "https://play.example/",
      "https://ignored.example/",
      "https://news.example/",
      "http://plain.example/",
      "https://www.bing.com/",
      "https://www.google.com.ph/",
      "https://duckduckgo.com/",
    ];
    for (const p of policies) {
      const rules = compileRules(p, { now: NOW });
      const categoryOf = categoryIndex(p);
      for (const url of urls) {
        const engine = evaluateUrl(p, url, { now: NOW, categoryOf }).decision;
        const browser = browserDecision(rules, url);
        // WARN is enforced as a block until the child chooses Continue; SafeSearch redirects only reachable engines
        expect(
          browser === "BLOCK" ? "BLOCK" : "ALLOW",
          `${url} under ${JSON.stringify(p).slice(0, 0)}#${policies.indexOf(p)}`,
        ).toBe(engine === "ALLOW" ? "ALLOW" : "BLOCK");
      }
    }
  });
});

describe("categoryIndex", () => {
  it("finds a host's category through its parent domains, only for blocked categories", () => {
    const of = categoryIndex(policy());
    expect(of("www.roblox.com")).toBe("GAMING");
    expect(of("m.facebook.com")).toBe("SOCIAL_MEDIA");
    expect(of("notroblox.com")).toBeNull();
    expect(of("ignored.example")).toBeNull();
  });
});

describe("rule comparison", () => {
  it("ignores fields the browser adds and the order it returns things in", () => {
    const expected = compileRules(policy(), { now: NOW });
    const installed = expected
      .map((r) => ({
        ...r,
        condition: {
          ...r.condition,
          requestDomains: r.condition.requestDomains ? [...r.condition.requestDomains].reverse() : undefined,
          isUrlFilterCaseSensitive: false,
        },
      }))
      .reverse();
    expect(sameRules(expected, installed)).toBe(true);
  });

  it("notices a removed, changed or extra rule", () => {
    const expected = compileRules(policy(), { now: NOW });
    expect(sameRules(expected, expected.slice(1))).toBe(false);
    const changed = expected.map((r, i) =>
      i === 1 ? { ...r, condition: { ...r.condition, requestDomains: ["other.example"] } } : r,
    );
    expect(sameRules(expected, changed)).toBe(false);
    expect(
      sameRules(expected, [
        ...expected,
        {
          id: 999,
          priority: 200,
          action: { type: "allow" },
          condition: { urlFilter: "|http", resourceTypes: ["main_frame"] },
        },
      ]),
    ).toBe(false);
    expect(ruleFingerprint(expected[0]!)).toBe(ruleFingerprint(structuredClone(expected[0]!)));
  });
});
