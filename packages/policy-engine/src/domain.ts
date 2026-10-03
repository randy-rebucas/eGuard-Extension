/** The host of an http(s) URL, lower-case without a trailing dot, or null for anything else. */
export function httpHost(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return u.hostname.toLowerCase().replace(/\.$/, "") || null;
}

/** A rule for example.com covers example.com and every subdomain, but not notexample.com. */
export function domainCovers(rule: string, host: string): boolean {
  return host === rule || host.endsWith(`.${rule}`);
}

/** The most specific rule in `rules` that covers `host`, if any. */
export function matchDomain(host: string, rules: readonly string[]): string | null {
  let best: string | null = null;
  for (const r of rules) if (domainCovers(r, host) && (!best || r.length > best.length)) best = r;
  return best;
}

/** How specific a domain rule is: games.example.com (3) is more specific than example.com (2). */
export function labelCount(domain: string): number {
  return domain.split(".").length;
}
