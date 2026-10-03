import { domainCovers, httpHost } from "./domain.ts";

/** Search engines eGuard enforces SafeSearch on. Each needs a host permission in the manifest. */
export const SAFE_SEARCH_ENGINES = [
  {
    host: "www.google.com",
    regexFilter: "^https?://(www\\.)?google\\.com/search\\?",
    param: { key: "safe", value: "active" },
  },
  {
    host: "www.google.com.ph",
    regexFilter: "^https?://(www\\.)?google\\.com\\.ph/search\\?",
    param: { key: "safe", value: "active" },
  },
  {
    host: "www.bing.com",
    regexFilter: "^https?://(www\\.)?bing\\.com/((images|videos|news)/)?search\\?",
    param: { key: "adlt", value: "strict" },
  },
  {
    // Also the no-JavaScript versions at html.duckduckgo.com/html/ and lite.duckduckgo.com/lite/
    host: "duckduckgo.com",
    regexFilter: "^https?://((www|html|lite)\\.)?duckduckgo\\.com/((html|lite)/?)?\\?",
    param: { key: "kp", value: "1" },
  },
] as const;

/**
 * Google search on its other country domains (google.co.uk, google.de, …). eGuard has no host access there, so it
 * can't add SafeSearch; with SafeSearch on, those searches are blocked instead (a plain block needs no host access)
 * and the block page points to google.com.
 */
export const UNSUPPORTED_SEARCH = {
  regexFilter: "^https?://(www\\.)?google\\.([a-z]{2,3}|com?\\.[a-z]{2})/search\\?",
  excludedRequestDomains: [...new Set(SAFE_SEARCH_ENGINES.map((e) => e.host.replace(/^www\./, "")))]
    .filter((d) => d.startsWith("google."))
    .sort(),
};

const unsupportedRe = new RegExp(UNSUPPORTED_SEARCH.regexFilter, "i");

/** Whether `url` is a search eGuard blocks because it can't enforce SafeSearch on that engine. */
export function unsupportedSearch(url: string): boolean {
  const host = httpHost(url);
  if (!host || UNSUPPORTED_SEARCH.excludedRequestDomains.some((d) => domainCovers(d, host))) return false;
  return unsupportedRe.test(url);
}
