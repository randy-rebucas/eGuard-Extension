import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.ts";
import { buildManifest } from "./manifest.ts";

const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const KEY = publicKey.export({ format: "der", type: "spki" }).toString("base64");

const devEnv = {
  VITE_API_URL: "http://localhost:3217",
  VITE_WEB_APP_URL: "http://localhost:3217",
  VITE_ENVIRONMENT: "development",
  VITE_POLICY_PUBLIC_KEY: KEY,
};
const prodEnv = {
  VITE_API_URL: "https://www.eguard.family",
  VITE_WEB_APP_URL: "https://www.eguard.family",
  VITE_ENVIRONMENT: "production",
  VITE_POLICY_PUBLIC_KEY: KEY,
};

describe("parseEnv", () => {
  it("accepts origins and normalises trailing slashes", () => {
    expect(parseEnv({ ...devEnv, VITE_API_URL: "http://localhost:3217/" }).VITE_API_URL).toBe(
      "http://localhost:3217",
    );
  });
  it("fails loudly on missing or unsafe values", () => {
    expect(() => parseEnv({})).toThrow(/VITE_API_URL/);
    expect(() => parseEnv({ ...devEnv, VITE_API_URL: "https://x.test/api" })).toThrow(/origin only/);
    expect(() => parseEnv({ ...prodEnv, VITE_API_URL: "http://www.eguard.family" })).toThrow(/https/);
  });
  it("refuses to build without the key that verifies family policies", () => {
    expect(() => parseEnv({ ...devEnv, VITE_POLICY_PUBLIC_KEY: undefined })).toThrow(
      /VITE_POLICY_PUBLIC_KEY/,
    );
    expect(() => parseEnv({ ...devEnv, VITE_POLICY_PUBLIC_KEY: "not-a-key" })).toThrow(/policy public key/);
  });
});

describe("buildManifest", () => {
  const env = parseEnv(prodEnv);

  it("requests only the minimum permissions, and never all sites", () => {
    const m = buildManifest({ target: "chrome", version: "1.2.3", env });
    expect(m.permissions).toEqual(["storage", "alarms", "declarativeNetRequest", "webNavigation", "privacy"]);
    // Safe Browsing can only be held on in Chrome; the other builds don't ask for `privacy`
    for (const target of ["edge", "firefox"] as const) {
      expect(buildManifest({ target, version: "1.2.3", env }).permissions).toEqual([
        "storage",
        "alarms",
        "declarativeNetRequest",
        "webNavigation",
      ]);
    }
    // The eGuard API, plus the search engines SafeSearch rewrites. Blocking itself needs no host access.
    expect(m.host_permissions).toEqual([
      "https://www.eguard.family/*",
      "*://*.google.com/*",
      "*://*.google.com.ph/*",
      "*://*.bing.com/*",
      "*://*.duckduckgo.com/*",
    ]);
    expect(JSON.stringify(m)).not.toMatch(/<all_urls>|\*:\/\/\*\//);
    expect(m).not.toHaveProperty("externally_connectable");
    expect(m).not.toHaveProperty("content_scripts");
  });

  it("sets a strict CSP that only allows the eGuard API", () => {
    const csp = (
      buildManifest({ target: "chrome", version: "1.0.0", env }).content_security_policy as {
        extension_pages: string;
      }
    ).extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self' https://www.eguard.family");
    expect(csp).not.toMatch(/unsafe-eval|unsafe-inline/);
  });

  it("uses a service worker on Chromium and background scripts with a gecko id on Firefox", () => {
    expect(buildManifest({ target: "edge", version: "1.0.0", env }).background).toEqual({
      service_worker: "background.js",
    });
    const fx = buildManifest({ target: "firefox", version: "1.0.0", env });
    expect(fx.background).toEqual({ scripts: ["background.js"] });
    expect(fx.browser_specific_settings).toEqual({
      gecko: {
        id: "browser-extension@eguard.family",
        // AMO rejects new add-ons without a data-collection declaration; Firefox 140 is the first to read it
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["browsingActivity"] },
      },
      gecko_android: { strict_min_version: "142.0" },
    });
    expect(fx).not.toHaveProperty("minimum_chrome_version");
  });

  it("labels non-production builds", () => {
    expect(buildManifest({ target: "chrome", version: "1.0.0", env: parseEnv(devEnv) }).name).toMatch(
      /development/,
    );
    expect(buildManifest({ target: "chrome", version: "1.0.0", env }).name).toBe("eGuard Browser Protection");
  });
});
