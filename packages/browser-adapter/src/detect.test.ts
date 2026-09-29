import { describe, expect, it } from "vitest";
import { detectBrowser, isSupportedBrowser } from "./detect.ts";

const UA = {
  chrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.4258.37",
  opera:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 OPR/115.0.0.0",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  oldFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0",
  safari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15",
  chromium:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/140.0.0.0 Safari/537.36",
};

describe("detectBrowser", () => {
  it("tells Chromium browsers apart", () => {
    expect(detectBrowser({ userAgent: UA.chrome })).toMatchObject({ family: "chrome", major: 153 });
    expect(detectBrowser({ userAgent: UA.edge })).toMatchObject({ family: "edge", major: 154, name: "Edge" });
    expect(detectBrowser({ userAgent: UA.opera })).toMatchObject({ family: "opera", major: 115 });
    expect(detectBrowser({ userAgent: UA.chrome, isBrave: true })).toMatchObject({
      family: "brave",
      major: 153,
    });
    expect(detectBrowser({ userAgent: UA.chromium })).toMatchObject({ family: "chrome", major: 140 });
  });

  it("prefers userAgentData brands (full versions, and Edge/Brave identity)", () => {
    const brands = [
      { brand: "Not)A;Brand", version: "99" },
      { brand: "Microsoft Edge", version: "154" },
      { brand: "Chromium", version: "154" },
    ];
    expect(detectBrowser({ userAgent: UA.chrome, brands })).toMatchObject({ family: "edge", major: 154 });
    expect(detectBrowser({ userAgent: UA.chrome, brands: [{ brand: "Brave", version: "1" }] }).family).toBe(
      "brave",
    );
  });

  it("detects Firefox and Safari", () => {
    expect(detectBrowser({ userAgent: UA.firefox })).toMatchObject({
      family: "firefox",
      major: 143,
      version: "143.0",
    });
    expect(detectBrowser({ userAgent: UA.safari })).toMatchObject({ family: "safari", major: 19 });
  });

  it("falls back without guessing a version", () => {
    expect(detectBrowser({ userAgent: "" })).toMatchObject({
      family: "chromium",
      version: null,
      major: null,
    });
  });
});

describe("isSupportedBrowser", () => {
  it("supports current Chrome, Edge and Firefox", () => {
    for (const ua of [UA.chrome, UA.edge, UA.firefox])
      expect(isSupportedBrowser(detectBrowser({ userAgent: ua }))).toBe(true);
  });
  it("refuses Safari (not validated) and versions below the minimum", () => {
    expect(isSupportedBrowser(detectBrowser({ userAgent: UA.safari }))).toBe(false);
    expect(isSupportedBrowser(detectBrowser({ userAgent: UA.oldFirefox }))).toBe(false);
  });
});
