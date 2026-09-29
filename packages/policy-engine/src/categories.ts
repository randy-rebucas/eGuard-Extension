import type { BrowserProtectionPolicy, WebCategory } from "@eguard/schemas";

/**
 * Host → category lookup over the signed category lists. A listed domain covers its subdomains, so a lookup
 * walks up the host's labels (m.facebook.com → facebook.com), which keeps it O(labels) for any list size.
 */
export function categoryIndex(policy: BrowserProtectionPolicy): (host: string) => WebCategory | null {
  const byDomain = new Map<string, WebCategory>();
  for (const [category, domains] of Object.entries(policy.categoryDomains) as [WebCategory, string[]][]) {
    if (!policy.blockedCategories.includes(category)) continue;
    for (const d of domains) if (!byDomain.has(d)) byDomain.set(d, category);
  }
  return (host) => {
    for (let h = host; h.includes("."); h = h.slice(h.indexOf(".") + 1)) {
      const c = byDomain.get(h);
      if (c) return c;
    }
    return null;
  };
}
