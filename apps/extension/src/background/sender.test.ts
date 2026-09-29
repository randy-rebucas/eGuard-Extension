import { describe, expect, it } from "vitest";
import { isTrustedSender } from "./sender.ts";

const ID = "abcdefghijklmnopabcdefghijklmnop";
const BASE = `chrome-extension://${ID}/`;

describe("isTrustedSender", () => {
  it("accepts this extension's own pages", () => {
    expect(isTrustedSender({ id: ID, url: `${BASE}popup/index.html` }, ID, BASE)).toBe(true);
    expect(isTrustedSender({ id: ID, url: `${BASE}onboarding/index.html#x` }, ID, BASE)).toBe(true);
  });

  it("refuses other extensions, web pages and content scripts", () => {
    expect(isTrustedSender({ id: "other", url: `${BASE}popup/index.html` }, ID, BASE)).toBe(false);
    // A content script sends with our id but the page's URL
    expect(isTrustedSender({ id: ID, url: "https://evil.example/" }, ID, BASE)).toBe(false);
    expect(isTrustedSender({ id: ID }, ID, BASE)).toBe(false);
    expect(isTrustedSender({}, ID, BASE)).toBe(false);
  });

  it("isn't fooled by look-alike prefixes", () => {
    expect(isTrustedSender({ id: ID, url: `chrome-extension://${ID}x/popup.html` }, ID, BASE)).toBe(false);
    expect(isTrustedSender({ id: ID, url: `${BASE}popup` }, ID, BASE.slice(0, -1))).toBe(false);
  });

  it("works for Firefox's moz-extension URLs (where URL.origin can be 'null')", () => {
    const fx = "moz-extension://2d3f5a4e-1111-2222-3333-444455556666/";
    expect(isTrustedSender({ id: ID, url: `${fx}popup/index.html` }, ID, fx)).toBe(true);
    expect(
      isTrustedSender({ id: ID, url: "moz-extension://99999999-1111-2222-3333-444455556666/x" }, ID, fx),
    ).toBe(false);
  });
});
