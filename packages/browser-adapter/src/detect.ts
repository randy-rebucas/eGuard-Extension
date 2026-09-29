import type { BrowserFamily, BrowserInfo } from "@eguard/schemas";

export type DetectInput = {
  userAgent: string;
  /** navigator.userAgentData.brands, where available (Chromium only). */
  brands?: readonly { brand: string; version: string }[] | undefined;
  /** navigator.brave exists (Brave hides itself from the UA string). */
  isBrave?: boolean;
};

const NAMES: Record<BrowserFamily, string> = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  safari: "Safari",
  brave: "Brave",
  opera: "Opera",
  chromium: "Chromium browser",
};

function info(family: BrowserFamily, version: string | null | undefined): BrowserInfo {
  const v = version ?? null;
  const major = v ? Number.parseInt(v, 10) : Number.NaN;
  return { family, name: NAMES[family], version: v, major: Number.isFinite(major) ? major : null };
}

/**
 * Works out which browser the extension is running in. Pure, so it can be tested with real UA strings.
 * Order matters: Edge and Opera also say "Chrome/", and every Chromium browser says "Safari/".
 */
export function detectBrowser({ userAgent: ua, brands, isBrave }: DetectInput): BrowserInfo {
  const brand = (name: string) => brands?.find((b) => b.brand === name)?.version;
  const uaVersion = (re: RegExp) => ua.match(re)?.[1];

  const firefox = uaVersion(/Firefox\/([\d.]+)/);
  if (firefox && !/Seamonkey/i.test(ua)) return info("firefox", firefox);

  const edge = brand("Microsoft Edge") ?? uaVersion(/Edg(?:e|A|iOS)?\/([\d.]+)/);
  if (edge) return info("edge", edge);

  const opera = brand("Opera") ?? uaVersion(/OPR\/([\d.]+)/);
  if (opera) return info("opera", opera);

  const chrome = uaVersion(/Chrom(?:e|ium)\/([\d.]+)/);
  if (isBrave || brand("Brave")) return info("brave", brand("Brave") ?? chrome);
  if (brand("Google Chrome")) return info("chrome", brand("Google Chrome"));
  if (chrome) return info(brand("Chromium") && !/Chrome\//.test(ua) ? "chromium" : "chrome", chrome);

  const safari = uaVersion(/Version\/([\d.]+).*Safari\//);
  if (safari) return info("safari", safari);

  return info("chromium", null);
}

/** Reads the environment of the running extension. */
export function detectCurrentBrowser(): BrowserInfo {
  // Absent in some worker contexts, whatever the DOM types say
  const nav = globalThis.navigator as
    | (Navigator & { userAgentData?: { brands: { brand: string; version: string }[] }; brave?: unknown })
    | undefined;
  return detectBrowser({
    userAgent: nav?.userAgent ?? "",
    brands: nav?.userAgentData?.brands,
    isBrave: nav?.brave !== undefined,
  });
}

/** Minimum versions we build for (manifest minimum_chrome_version / strict_min_version). */
export const MIN_VERSION: Partial<Record<BrowserFamily, number>> = {
  chrome: 120,
  edge: 120,
  brave: 120,
  opera: 106,
  chromium: 120,
  firefox: 128,
};

/**
 * Whether eGuard can protect this browser at all. Safari isn't validated yet, so it is
 * reported as unsupported rather than guessed at (spec §52).
 */
export function isSupportedBrowser(b: BrowserInfo): boolean {
  const min = MIN_VERSION[b.family];
  if (min === undefined) return false;
  return b.major === null || b.major >= min;
}
