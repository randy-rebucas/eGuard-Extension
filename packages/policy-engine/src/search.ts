import { domainCovers, httpHost } from "./domain.ts";

/**
 * A host part of a URL regex that also matches the host written with a trailing dot (www.google.com./search
 * reaches Google, but a regex ending in `google\.com/` misses it).
 */
const dot = "\\.?";

/** Search engines eGuard enforces SafeSearch on. Each needs a host permission in the manifest. */
export const SAFE_SEARCH_ENGINES = [
  {
    host: "www.google.com",
    regexFilter: `^https?://(www\\.)?google\\.com${dot}/search\\?`,
    param: { key: "safe", value: "active" },
  },
  {
    host: "www.google.com.ph",
    regexFilter: `^https?://(www\\.)?google\\.com\\.ph${dot}/search\\?`,
    param: { key: "safe", value: "active" },
  },
  {
    // Also Bing's country hosts (cn.bing.com, …), covered by the *.bing.com host permission
    host: "www.bing.com",
    regexFilter: `^https?://([a-z0-9-]+\\.)?bing\\.com${dot}/((images|videos|news)/)?search\\?`,
    param: { key: "adlt", value: "strict" },
  },
  {
    // Also the no-JavaScript versions at html.duckduckgo.com/html/ and lite.duckduckgo.com/lite/
    host: "duckduckgo.com",
    regexFilter: `^https?://((www|html|lite)\\.)?duckduckgo\\.com${dot}/((html|lite)/?)?\\?`,
    param: { key: "kp", value: "1" },
  },
] as const;

/** The domain a SafeSearch engine's rule covers (google.com for www.google.com). */
export const engineDomain = (e: (typeof SAFE_SEARCH_ENGINES)[number]) => e.host.replace(/^www\./, "");

const engineDomains = [...new Set(SAFE_SEARCH_ENGINES.map(engineDomain))].sort();

/**
 * Searches eGuard can't add SafeSearch to, blocked while SafeSearch is on (a plain block needs no host access);
 * the block page points to an engine where it works:
 * - Google's other country domains (google.co.uk, google.de, …): no host access there.
 * - The enforced engines written with a trailing dot: their redirects don't match, and host access may not cover
 *   them. Their other pages are blocked too; nobody browses google.com. on purpose.
 * - Engines with their own adult filter eGuard can't switch on (Yahoo, Brave, Yandex, Ecosia, Startpage, Qwant):
 *   search pages only, the rest of those sites opens as the policy says.
 */
export const UNSUPPORTED_SEARCHES: { regexFilter: string; excludedRequestDomains?: string[] }[] = [
  {
    regexFilter: `^https?://(www\\.)?google\\.([a-z]{2,3}|com?\\.[a-z]{2})${dot}/search\\?`,
    excludedRequestDomains: engineDomains.filter((d) => d.startsWith("google.")),
  },
  {
    regexFilter: `^https?://([^/?#]*@)?([a-z0-9-]+\\.)*(${engineDomains.map((d) => d.replaceAll(".", "\\.")).join("|")})\\.(:[0-9]+)?([/?#]|$)`,
  },
  // One rule each: Chromium refuses a regex over its memory limit, and one refused rule fails the whole update
  ...[
    `search\\.yahoo\\.com${dot}/(search|images|video)`,
    `search\\.brave\\.com${dot}/(search|images|videos|news)`,
    `yandex\\.[a-z]{2,3}(\\.[a-z]{2})?${dot}/((images|video)/)?search`,
    `ecosia\\.org${dot}/(search|images|videos|news)`,
    `startpage\\.com${dot}/(do|sp)/search`,
    `qwant\\.com${dot}/\\?`,
  ].map((engine) => ({ regexFilter: `^https?://([a-z0-9-]+\\.)*${engine}` })),
];

const unsupported = UNSUPPORTED_SEARCHES.map((u) => ({
  re: new RegExp(u.regexFilter, "i"),
  excluded: u.excludedRequestDomains ?? [],
}));

/** Whether `url` is a search eGuard blocks because it can't enforce SafeSearch on that engine. */
export function unsupportedSearch(url: string): boolean {
  const host = httpHost(url);
  if (!host) return false;
  return unsupported.some((u) => !u.excluded.some((d) => domainCovers(d, host)) && u.re.test(url));
}

/**
 * SafeSearch engines a host belongs to. "Continue" on a warned www.google.com opens it through a session rule
 * above the compiled rules, so its SafeSearch redirect has to come with it (enforcement.ts).
 */
export function safeSearchEnginesFor(host: string) {
  return SAFE_SEARCH_ENGINES.filter((e) => domainCovers(engineDomain(e), host));
}
