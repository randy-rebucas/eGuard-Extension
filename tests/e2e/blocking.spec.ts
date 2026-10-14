import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { SAFE_SEARCH_ENGINES, UNSUPPORTED_SEARCHES, exactHostFilter } from "@eguard/policy-engine";
import { E2E_PORT, expect, onboardingPage, test } from "./fixtures.ts";

/**
 * Real blocking in Chromium: the browser enforces eGuard's declarativeNetRequest rules and the block page takes
 * over. Test sites are http://<name>.example:3299/, mapped to the mock server (see fixtures.ts).
 */
const site = (name: string, path = "/") => `http://${name}.example:${E2E_PORT}${path}`;

async function pair(context: BrowserContext, extensionId: string) {
  const page = await onboardingPage(context, extensionId);
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByLabel("Pairing code").fill("824917");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("heading", { name: "Review protection" })).toBeVisible();
}

/** Opens `url` in a new tab the way a child would; blocked loads end on the eGuard block page. */
async function visit(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url).catch(() => {}); // a blocked load rejects with net::ERR_BLOCKED_BY_CLIENT
  return page;
}

const onBlockPage = (page: Page) => expect(page).toHaveURL(/\/blocked\/index\.html\?u=/, { timeout: 10_000 });

test("blocks a site the family blocked, and a category site, with a calm block page", async ({
  context,
  extensionId,
  worker,
}) => {
  await pair(context, extensionId);
  const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  expect(
    rules.some((r) => r.action.type === "block" && r.condition.requestDomains?.includes("blocked.example")),
  ).toBe(true);

  const blocked = await visit(context, site("m.blocked", "/some/page"));
  await onBlockPage(blocked);
  await expect(blocked.getByRole("heading", { name: "This website is blocked" })).toBeVisible();
  await expect(blocked.getByText("m.blocked.example", { exact: true })).toBeVisible();
  await expect(blocked.getByText(/doesn't match the settings your family chose/)).toBeVisible();

  const game = await visit(context, site("play"));
  await onBlockPage(game);
  await expect(game.getByText(/category your family blocks: Gaming/)).toBeVisible();
});

test("opens allowed and ordinary sites normally", async ({ context, extensionId }) => {
  await pair(context, extensionId);
  const school = await visit(context, site("school"));
  await expect(school.getByRole("heading", { name: "Welcome to school.example" })).toBeVisible();
  const news = await visit(context, site("news"));
  await expect(news.getByRole("heading", { name: "Welcome to news.example" })).toBeVisible();
});

test("a child asks a parent, and the site opens after approval", async ({
  context,
  extensionId,
  backend,
}) => {
  await pair(context, extensionId);
  const page = await visit(context, site("blocked", "/homework"));
  await onBlockPage(page);

  await page.getByRole("button", { name: "Ask a parent" }).click();
  await page.getByLabel(/Why do you need it/).fill("School project");
  await page.getByRole("button", { name: "Send to a parent" }).click();
  await expect(page.getByText(/You asked a parent/)).toBeVisible();
  expect(backend.state.accessRequests).toEqual([
    expect.objectContaining({ domain: "blocked.example", reason: "School project" }),
  ]);

  // Not answered yet: checking again stays put
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText("No answer yet.")).toBeVisible();

  // The parent allows it for an hour: a new signed policy version
  backend.state.accessRequests[0]!.status = "APPROVED";
  backend.state.policyVersion = 2;
  backend.state.policyPatch = {
    temporaryAllows: [{ domain: "blocked.example", until: new Date(Date.now() + 3600_000).toISOString() }],
  };
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to blocked.example" })).toBeVisible();
  await expect(page).toHaveURL(site("blocked", "/homework"));
});

test("'Warn first' sites can be continued; 'allowed only' sites can't", async ({
  context,
  extensionId,
  backend,
  worker,
}) => {
  backend.state.policyPatch = { unknownSitesPolicy: "WARN" };
  await pair(context, extensionId);
  const page = await visit(context, site("news", "/today"));
  await onBlockPage(page);
  await expect(page.getByRole("heading", { name: "Before you continue" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to site" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to news.example" })).toBeVisible();
  // Continue opened that exact site only, not its subdomains
  const sub = await visit(context, site("games.news"));
  await onBlockPage(sub);
  await expect(sub.getByRole("heading", { name: "Before you continue" })).toBeVisible();

  // A parent switches to allowed-only: no Continue button, and the worker refuses one anyway
  backend.state.policyVersion = 2;
  backend.state.policyPatch = { unknownSitesPolicy: "BLOCK" };
  await worker.evaluate(() => chrome.alarms.clearAll()); // keep the test in charge of timing
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await popup.getByRole("button", { name: "Run health check" }).click();
  await expect(popup.getByText("Version 2", { exact: true })).toBeVisible();

  const other = await visit(context, site("other"));
  await onBlockPage(other);
  await expect(other.getByRole("heading", { name: "This website isn't on your list" })).toBeVisible();
  await expect(other.getByRole("button", { name: "Continue to site" })).toHaveCount(0);
  const forced = await other.evaluate(
    (url) =>
      chrome.runtime.sendMessage<unknown, { ok: boolean; code?: string }>({ type: "CONTINUE_TO_SITE", url }),
    site("other"),
  );
  expect(forced).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
});

test("SafeSearch rules are installed for the search engines", async ({ context, extensionId, worker }) => {
  await pair(context, extensionId);
  const redirects = await worker.evaluate(async () =>
    (await chrome.declarativeNetRequest.getDynamicRules())
      .filter((r) => r.action.type === "redirect")
      .map((r) => [
        r.condition.regexFilter,
        r.action.redirect?.transform?.queryTransform?.addOrReplaceParams?.[0],
      ]),
  );
  expect(redirects).toEqual(SAFE_SEARCH_ENGINES.map((e) => [e.regexFilter, e.param]));
  // Searches eGuard can't make safe (Google's country domains, trailing-dot hosts, other engines) are blocked.
  // Installed and read back means the browser accepted every regex and the exclusions.
  const unsupported = await worker.evaluate(async () =>
    (await chrome.declarativeNetRequest.getDynamicRules()).filter(
      (r) => r.action.type === "block" && r.priority === 110,
    ),
  );
  expect(unsupported).toHaveLength(UNSUPPORTED_SEARCHES.length);
  expect(unsupported[0]).toMatchObject({
    condition: { excludedRequestDomains: ["google.com", "google.com.ph"] },
  });

  // Chromium's own matcher, without the network: what each search ends as
  const outcome = (url: string) =>
    worker.evaluate(async (u) => {
      const res = await chrome.declarativeNetRequest.testMatchOutcome({ url: u, type: "main_frame" });
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      return res.matchedRules.map((m) => rules.find((r) => r.id === m.ruleId)?.action.type);
    }, url);
  expect(await outcome("https://www.google.com/search?q=x")).toEqual(["redirect"]);
  expect(await outcome("https://cn.bing.com/search?q=x")).toEqual(["redirect"]);
  for (const url of [
    "https://www.google.com./search?q=x",
    "https://www.bing.com./search?q=x",
    "https://www.google.co.uk/search?q=x",
    "https://search.yahoo.com/search?p=x",
    "https://yandex.ru/search/?text=x",
  ]) {
    expect(await outcome(url), url).toEqual(["block"]);
  }
});

test("YouTube Restricted Mode: Chromium takes the header rule, reads it back as in place, and applies it above an allow", async ({
  context,
  extensionId,
  backend,
  worker,
}) => {
  // An allowed youtube.com would cancel a header rule ranked below it
  backend.state.policyPatch = {
    youtubeRestrict: "STRICT",
    allowedDomains: ["school.example", "youtube.com"],
  };
  // Stands in for a parent allowing eGuard in private windows, so the status can reach Protected
  await worker.evaluate(() => {
    Object.defineProperty(chrome.extension, "isAllowedIncognitoAccess", {
      value: () => Promise.resolve(true),
      configurable: true,
    });
  });
  await pair(context, extensionId);
  const header = await worker.evaluate(async () =>
    (await chrome.declarativeNetRequest.getDynamicRules()).find((r) => r.action.type === "modifyHeaders"),
  );
  expect(header?.action.requestHeaders).toEqual([
    { header: "YouTube-Restrict", operation: "set", value: "Strict" },
  ]);

  // The string values: @types/chrome declares ResourceType as an enum, which the test can't import
  const outcome = (url: string, type: `${chrome.declarativeNetRequest.ResourceType}`) =>
    worker.evaluate(
      async ([u, t]) => {
        const res = await chrome.declarativeNetRequest.testMatchOutcome({ url: u, type: t });
        const rules = await chrome.declarativeNetRequest.getDynamicRules();
        return res.matchedRules.map((m) => rules.find((r) => r.id === m.ruleId)?.action.type).sort();
      },
      [url, type] as const,
    );
  // The page, the player's API calls and embeds all carry it; other Google hosts don't
  expect(await outcome("https://www.youtube.com/results?search_query=x", "main_frame")).toContain(
    "modifyHeaders",
  );
  expect(await outcome("https://m.youtube.com/watch?v=1", "main_frame")).toContain("modifyHeaders");
  expect(await outcome("https://www.youtube.com/youtubei/v1/search", "xmlhttprequest")).toContain(
    "modifyHeaders",
  );
  expect(await outcome("https://youtubei.googleapis.com/youtubei/v1/player", "xmlhttprequest")).toContain(
    "modifyHeaders",
  );
  expect(await outcome("https://www.youtube-nocookie.com/embed/1", "sub_frame")).toContain("modifyHeaders");
  expect(await outcome("https://maps.googleapis.com/x", "xmlhttprequest")).toEqual([]);

  // Rules read back match what the policy asks for (a mismatch would show "rules not in place")
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await expect(popup.getByRole("heading", { name: "Protection active" })).toBeVisible({ timeout: 10_000 });
});

test("Chromium accepts every regex eGuard compiles (one refused rule fails the whole update)", async ({
  worker,
}) => {
  const all = [
    ...SAFE_SEARCH_ENGINES.map((e) => e.regexFilter),
    ...UNSUPPORTED_SEARCHES.map((u) => u.regexFilter),
    exactHostFilter("news.example.org"),
  ];
  const res = await worker.evaluate(
    (list) => Promise.all(list.map((regex) => chrome.declarativeNetRequest.isRegexSupported({ regex }))),
    all,
  );
  expect(res.map((r, i) => (r.isSupported ? "ok" : `${all[i]}: ${r.reason}`))).toEqual(all.map(() => "ok"));
});

test("a trailing dot doesn't get past blocked sites or categories", async ({ context, extensionId }) => {
  await pair(context, extensionId);
  for (const name of ["blocked", "play"]) {
    const page = await visit(context, `http://${name}.example.:${E2E_PORT}/`);
    await onBlockPage(page);
  }
});

test("'Continue' on a warned search engine keeps SafeSearch on", async ({
  context,
  extensionId,
  backend,
  worker,
}) => {
  backend.state.policyPatch = { unknownSitesPolicy: "WARN" };
  await pair(context, extensionId);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  const res = await popup.evaluate(() =>
    chrome.runtime.sendMessage<unknown, { ok: boolean }>({
      type: "CONTINUE_TO_SITE",
      url: "https://www.google.com/",
    }),
  );
  expect(res).toMatchObject({ ok: true });
  const matched = await worker.evaluate(async () => {
    const res = await chrome.declarativeNetRequest.testMatchOutcome({
      url: "https://www.google.com/search?q=x",
      type: "main_frame",
    });
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    return res.matchedRules.map((m) => [m.rulesetId, rules.find((r) => r.id === m.ruleId)?.action.type]);
  });
  expect(matched).toEqual([["_session", "redirect"]]);
});

test("an unsigned 'removed' answer never lifts the rules", async ({
  context,
  extensionId,
  backend,
  worker,
}) => {
  await pair(context, extensionId);
  const before = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  backend.state.forgedRevocation = true;
  await worker.evaluate(() => chrome.storage.session.clear()); // the access token: the next call refreshes
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await popup.getByRole("button", { name: "Run health check" }).click();
  await expect(popup.getByText("Sync paused").first()).toBeVisible({ timeout: 10_000 });
  expect(await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).toEqual(before);
  await onBlockPage(await visit(context, site("blocked")));
});

test("removing the browser removes every rule", async ({ context, extensionId, backend, worker }) => {
  await pair(context, extensionId);
  expect(
    (await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length,
  ).toBeGreaterThan(0);
  backend.state.revoked = true;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await popup.getByRole("button", { name: "Run health check" }).click();
  await expect(popup.getByRole("button", { name: "Connect to eGuard" })).toBeVisible();
  expect(await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).toEqual([]);
  const page = await visit(context, site("blocked"));
  await expect(page.getByRole("heading", { name: "Welcome to blocked.example" })).toBeVisible();
});

test("accessibility: the block page, its request form and the warning have no axe violations", async ({
  context,
  extensionId,
  backend,
}) => {
  const scan = async (page: Page) => {
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
      [],
    );
  };
  backend.state.policyPatch = { unknownSitesPolicy: "WARN" };
  await pair(context, extensionId);
  const blocked = await visit(context, site("blocked"));
  await onBlockPage(blocked);
  await expect(blocked.getByRole("heading", { name: "This website is blocked" })).toBeVisible();
  await scan(blocked);
  await blocked.getByRole("button", { name: "Ask a parent" }).click();
  await expect(blocked.getByLabel(/Why do you need it/)).toBeFocused();
  await scan(blocked);
  const warn = await visit(context, site("news"));
  await onBlockPage(warn);
  await expect(warn.getByRole("heading", { name: "Before you continue" })).toBeVisible();
  await scan(warn);
});
