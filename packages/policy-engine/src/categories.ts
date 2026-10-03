import type { BrowserProtectionPolicy } from "@eguard/schemas";

/**
 * Host → category lookup over the signed category lists. A listed domain covers its subdomains, so a lookup
 * walks up the host's labels (m.facebook.com → facebook.com), which keeps it O(labels) for any list size.
 * Category keys are open-ended: one this build has no label for is still blocked if the family blocks it.
 */
export function categoryIndex(policy: BrowserProtectionPolicy): (host: string) => string | null {
  const byDomain = new Map<string, string>();
  for (const category of [...policy.blockedCategories].sort()) {
    for (const d of policy.categoryDomains[category] ?? []) if (!byDomain.has(d)) byDomain.set(d, category);
  }
  return (host) => {
    for (let h = host; h.includes("."); h = h.slice(h.indexOf(".") + 1)) {
      const c = byDomain.get(h);
      if (c) return c;
    }
    return null;
  };
}
