import { describe, expect, it } from "vitest";
import type { BrowserProtectionPolicy } from "@eguard/schemas";
import {
  PRIORITY,
  SAFE_SEARCH_ENGINES,
  categoryIndex,
  compileRules,
  evaluateUrl,
  domainCovers,
  httpHost,
  listPriority,
  ruleFingerprint,
  sameRules,
  unsupportedSearch,
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
    const c = r.condition;
    // Header rules change the request, never whether it loads
    if (r.action.type === "modifyHeaders") return false;
    if (!c.resourceTypes.includes("main_frame") || !host) return false;
    if (c.excludedRequestDomains?.some((d) => domainCovers(d, host))) return false;
    if (c.requestDomains && !c.requestDomains.some((d) => domainCovers(d, host))) return false;
    if (c.urlFilter !== undefined && !(c.urlFilter === "|http" && /^https?:/.test(url))) return false;
    // Browsers match regexFilter case-insensitively unless told otherwise
    if (c.regexFilter !== undefined && !new RegExp(c.regexFilter, "i").test(url)) return false;
    return true;
  });
  if (!matches.length) return "ALLOW";
  const rankOf = (r: DnrRule) => (r.action.type === "modifyHeaders" ? 0 : rank[r.action.type]);
  const top = matches.sort((a, b) => b.priority - a.priority || rankOf(b) - rankOf(a))[0]!;
  return top.action.type === "block" ? "BLOCK" : top.action.type === "redirect" ? "REDIRECT" : "ALLOW";
}

describe("compileRules", () => {
  it("blocks sites and only the categories the family chose, with allowed sites on top", () => {
    const rules = compileRules(policy(), { now: NOW, alwaysAllow: ["www.eguard.family"] });
    const byPriority = (p: number) => rules.filter((r) => r.priority === p);
    expect(byPriority(PRIORITY.allow)[0]?.condition.requestDomains).toEqual(["www.eguard.family"]);
    // The parent's lists rank by specificity, every one above the categories and below approvals
    expect(byPriority(listPriority("school.example", "allow"))[0]).toMatchObject({
      action: { type: "allow" },
      condition: { requestDomains: ["school.example"] },
    });
    expect(byPriority(listPriority("games.school.example", "allow"))[0]?.condition.requestDomains).toEqual([
      "games.school.example",
    ]);
    expect(byPriority(listPriority("blocked.example", "block"))[0]).toMatchObject({
      action: { type: "block" },
      condition: { requestDomains: ["blocked.example"] },
    });
    expect(byPriority(listPriority("google.com.ph", "block"))[0]?.condition.requestDomains).toEqual([
      "google.com.ph",
    ]);
    for (const r of rules.filter((r) => r.priority !== PRIORITY.allow && r.condition.requestDomains)) {
      expect(r.priority).toBeLessThan(PRIORITY.allow);
      expect(r.priority).toBeGreaterThanOrEqual(PRIORITY.category);
    }
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
      SAFE_SEARCH_ENGINES.find((e) => e.host === "www.bing.com")!.regexFilter,
    ]);
  });

  it("covers each engine's other search pages, and blocks Google searches it can't make safe", () => {
    const rules = compileRules(policy({ blockedDomains: [] }), { now: NOW });
    const redirects = (url: string) => browserDecision(rules, url) === "REDIRECT";
    expect(redirects("https://www.google.com/search?q=x")).toBe(true);
    expect(redirects("https://www.bing.com/images/search?q=x")).toBe(true);
    expect(redirects("https://www.bing.com/videos/search?q=x")).toBe(true);
    expect(redirects("https://html.duckduckgo.com/html/?q=x")).toBe(true);
    expect(redirects("https://lite.duckduckgo.com/lite/?q=x")).toBe(true);
    expect(browserDecision(rules, "https://www.google.co.uk/search?q=x")).toBe("BLOCK");
    expect(browserDecision(rules, "https://www.google.de/search?q=x")).toBe("BLOCK");
    expect(browserDecision(rules, "https://www.google.co.uk/maps")).toBe("ALLOW");
    expect(browserDecision(rules, "https://www.google.com.ph/search?q=x")).toBe("REDIRECT");
    expect(unsupportedSearch("https://www.google.co.uk/search?q=x")).toBe(true);
    expect(unsupportedSearch("https://www.google.com/search?q=x")).toBe(false);
    // Bing's country hosts get SafeSearch too
    expect(redirects("https://cn.bing.com/search?q=x")).toBe(true);
    // A trailing dot reaches the same engine but slips past the redirects: blocked instead
    for (const url of [
      "https://www.google.com./search?q=x",
      "https://google.com.:443/search?q=x",
      "https://www.bing.com./images/search?q=x",
      "https://duckduckgo.com./?q=x",
      "https://www.google.co.uk./search?q=x",
    ]) {
      expect(browserDecision(rules, url), url).toBe("BLOCK");
      expect(unsupportedSearch(url), url).toBe(true);
    }
    // Engines whose own filter eGuard can't switch on: their searches are blocked, the rest of the site isn't
    for (const url of [
      "https://search.yahoo.com/search?p=x",
      "https://ph.search.yahoo.com/search?p=x",
      "https://search.brave.com/images?q=x",
      "https://yandex.ru/search/?text=x",
      "https://yandex.com/images/search?text=x",
      "https://www.ecosia.org/search?q=x",
      "https://www.startpage.com/sp/search?query=x",
      "https://www.qwant.com/?q=x",
    ]) {
      expect(browserDecision(rules, url), url).toBe("BLOCK");
      expect(unsupportedSearch(url), url).toBe(true);
    }
    expect(browserDecision(rules, "https://mail.yahoo.com/")).toBe("ALLOW");
    expect(browserDecision(rules, "https://www.ecosia.org/")).toBe("ALLOW");
    expect(unsupportedSearch("https://news.example/search?q=x")).toBe(false);
    expect(unsupportedSearch("https://notgoogle.com./x")).toBe(false);
    expect(compileRules(policy({ safeSearch: false }), { now: NOW }).some((r) => r.priority === 110)).toBe(
      false,
    );
  });

  it("sets YouTube's Restricted Mode header at the level the policy asks for, above every allow", () => {
    const header = (p: BrowserProtectionPolicy) =>
      compileRules(p, { now: NOW, alwaysAllow: ["www.eguard.family"] }).filter(
        (r) => r.action.type === "modifyHeaders",
      );
    // Older servers don't send the field: nothing to set
    expect(header(policy())).toEqual([]);
    expect(header(policy({ youtubeRestrict: "OFF" }))).toEqual([]);
    const [moderate] = header(policy({ youtubeRestrict: "MODERATE", safeSearch: false }));
    expect(moderate).toMatchObject({
      priority: PRIORITY.safeSearch,
      action: { requestHeaders: [{ header: "YouTube-Restrict", operation: "set", value: "Moderate" }] },
      condition: {
        requestDomains: [
          "youtube.com",
          "youtube-nocookie.com",
          "youtubei.googleapis.com",
          "youtube.googleapis.com",
        ],
        // The player and search load over XHR from www.youtube.com, and embeds are frames
        resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"],
      },
    });
    // An allowed youtube.com (priority 54–91) would skip a header rule ranked below it
    expect(moderate!.priority).toBeGreaterThan(PRIORITY.allow);
    expect(header(policy({ youtubeRestrict: "STRICT" }))[0]?.action).toMatchObject({
      requestHeaders: [{ value: "Strict" }],
    });
    // A level this build doesn't know fails closed
    expect(header(policy({ youtubeRestrict: "KIDS" }))[0]?.action).toMatchObject({
      requestHeaders: [{ value: "Strict" }],
    });
    // It changes requests, not what opens
    const rules = compileRules(policy({ youtubeRestrict: "STRICT", blockedDomains: [] }), { now: NOW });
    expect(browserDecision(rules, "https://www.youtube.com/watch?v=1")).toBe("ALLOW");
  });

  it("compares header rules by header, case-insensitively, and value", () => {
    const rule = compileRules(policy({ youtubeRestrict: "MODERATE" }), { now: NOW }).find(
      (r) => r.action.type === "modifyHeaders",
    )!;
    const stored = {
      ...rule,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "youtube-restrict", operation: "set", value: "Moderate" }],
      },
    };
    expect(ruleFingerprint(stored)).toBe(ruleFingerprint(rule));
    const strict = {
      ...rule,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "YouTube-Restrict", operation: "set", value: "Strict" }],
      },
    };
    expect(ruleFingerprint(strict)).not.toBe(ruleFingerprint(rule));
  });

  it("drops expired approvals", () => {
    const p = policy({
      temporaryAllows: [
        { domain: "roblox.com", until: "2026-09-29T05:00:00Z" }, // 13:00 Manila, still on
        { domain: "facebook.com", until: "2026-09-29T03:00:00Z" }, // 11:00 Manila, over
      ],
    });
    const domains = compileRules(p, { now: NOW })
      .filter((r) => r.action.type === "allow")
      .flatMap((r) => r.condition.requestDomains ?? []);
    expect(domains).toContain("roblox.com");
    expect(domains).not.toContain("facebook.com");
  });

  it("an approval ranks like an allowed site: a more specific blocked site stays blocked", () => {
    const p = policy({
      allowedDomains: [],
      blockedDomains: ["games.school.example"],
      temporaryAllows: [{ domain: "school.example", until: "2026-09-29T05:00:00Z" }],
    });
    const rules = compileRules(p, { now: NOW });
    expect(browserDecision(rules, "https://school.example/")).toBe("ALLOW");
    expect(browserDecision(rules, "https://games.school.example/")).toBe("BLOCK");
    expect(evaluateUrl(p, "https://games.school.example/", { now: NOW }).reason.type).toBe("BLOCKED_SITE");
    // The child asked for exactly the blocked site: the approval opens it (a tie goes to allowed)
    const same = policy({
      allowedDomains: [],
      blockedDomains: ["games.school.example"],
      temporaryAllows: [{ domain: "games.school.example", until: "2026-09-29T05:00:00Z" }],
    });
    expect(browserDecision(compileRules(same, { now: NOW }), "https://games.school.example/")).toBe("ALLOW");
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
      // Allowed school.example, blocked games.school.example inside it, allowed again one level deeper
      policy({
        allowedDomains: ["school.example", "ok.games.school.example"],
        blockedDomains: ["games.school.example"],
      }),
      policy({
        allowedDomains: ["school.example"],
        blockedDomains: ["games.school.example"],
        unknownSitesPolicy: "BLOCK",
        temporaryAllows: [{ domain: "games.school.example", until: "2026-09-29T05:00:00Z" }],
      }),
      policy({ unknownSitesPolicy: "SOMETHING_NEW" }),
      policy({ safeSearch: false }),
      policy({
        allowedDomains: [],
        blockedDomains: ["games.school.example"],
        temporaryAllows: [{ domain: "school.example", until: "2026-09-29T05:00:00Z" }],
        unknownSitesPolicy: "BLOCK",
      }),
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
      "https://ok.games.school.example/",
      "https://x.games.school.example/",
      "https://www.google.co.uk/search?q=x",
      "https://www.google.com/search?q=x",
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

  it("matches redirects as Firefox stores them (nulls for unset fields, replaceOnly: false)", () => {
    const expected = compileRules({ ...policy(), safeSearch: true }, { now: NOW });
    expect(expected.some((r) => r.action.type === "redirect")).toBe(true);
    const installed = expected.map((r) =>
      r.action.type === "redirect"
        ? {
            ...r,
            action: {
              type: "redirect",
              redirect: {
                extensionPath: null,
                url: null,
                regexSubstitution: null,
                transform: {
                  scheme: null,
                  host: null,
                  queryTransform: {
                    removeParams: null,
                    addOrReplaceParams: r.action.redirect.transform.queryTransform.addOrReplaceParams.map(
                      (p) => ({ ...p, replaceOnly: false }),
                    ),
                  },
                },
              },
            },
          }
        : r,
    );
    expect(sameRules(expected, installed)).toBe(true);
    const otherParam = structuredClone(installed);
    const redirect = otherParam.find((r) => r.action.type === "redirect")!.action as {
      redirect: { transform: { queryTransform: { addOrReplaceParams: { value: string }[] } } };
    };
    redirect.redirect.transform.queryTransform.addOrReplaceParams[0]!.value = "off";
    expect(sameRules(expected, otherParam)).toBe(false);
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
