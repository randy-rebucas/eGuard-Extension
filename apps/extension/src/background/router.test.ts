import { describe, expect, it } from "vitest";
import { handleMessage } from "./router.ts";
import { harness, pairOk, policy, signed } from "./test-harness.ts";

const ID = "abcdefghijklmnopabcdefghijklmnop";
const BASE = `chrome-extension://${ID}/`;
const trust = { runtimeId: ID, extensionBase: BASE };
const popup = { id: ID, url: `${BASE}popup/index.html` };

describe("handleMessage", () => {
  it("answers status requests from extension pages", async () => {
    const res = await handleMessage({ type: "GET_PROTECTION_STATUS" }, popup, harness().service, trust);
    expect(res).toMatchObject({
      ok: true,
      status: { state: "ACTION_REQUIRED", connection: { paired: false } },
    });
  });

  it("refuses messages from web pages or content scripts before parsing them", async () => {
    const h = harness({ "/api/browser/v1/pair": pairOk });
    const res = await handleMessage(
      { type: "PAIR_WITH_CODE", code: "824917" },
      { id: ID, url: "https://evil.example/" },
      h.service,
      trust,
    );
    expect(res).toEqual({ ok: false, code: "FORBIDDEN", error: "This request isn't allowed." });
    expect(h.calls).toHaveLength(0);
  });

  it("rejects malformed messages", async () => {
    const h = harness();
    expect(await handleMessage({ type: "DISABLE_PROTECTION" }, popup, h.service, trust)).toMatchObject({
      ok: false,
      code: "INVALID_MESSAGE",
    });
    expect(await handleMessage("GET_PROTECTION_STATUS", popup, h.service, trust)).toMatchObject({
      ok: false,
      code: "INVALID_MESSAGE",
    });
    expect(
      await handleMessage({ type: "PAIR_WITH_CODE", code: "12" }, popup, h.service, trust),
    ).toMatchObject({ ok: false, code: "INVALID_CODE" });
  });

  it("pairs and returns fresh status", async () => {
    const h = harness({
      "/api/browser/v1/pair": pairOk,
      "/api/browser/v1/policy": () => ({ status: 200, json: signed(policy(1)) }),
    });
    const res = await handleMessage({ type: "PAIR_WITH_CODE", code: "824 917" }, popup, h.service, trust);
    expect(res).toMatchObject({
      ok: true,
      status: { connection: { paired: true, childName: "Mia" }, policyVersion: 1 },
    });
    expect(h.calls[0]?.body).toMatchObject({ code: "824917" });
  });

  it("returns block info with the status, and needs a connection to ask a parent", async () => {
    const h = harness();
    const info = await handleMessage(
      { type: "GET_BLOCK_INFO", url: "https://example.com/" },
      popup,
      h.service,
      trust,
    );
    // No policy: nothing is blocked, so the block page will simply open the site
    expect(info).toMatchObject({ ok: true, block: { host: "example.com", decision: "ALLOW" } });
    const ask = await handleMessage(
      { type: "REQUEST_ACCESS", url: "https://example.com/" },
      popup,
      h.service,
      trust,
    );
    expect(ask).toMatchObject({ ok: false, code: "NOT_CONNECTED" });
  });

  it("hides internal errors behind a calm message", async () => {
    const h = harness();
    h.service.getStatus = () => Promise.reject(new Error("storage exploded at line 12"));
    const res = await handleMessage({ type: "GET_PROTECTION_STATUS" }, popup, h.service, trust, h.log);
    expect(res).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(res)).not.toContain("exploded");
    expect(h.log).toHaveBeenCalledWith("message_failed", expect.anything());
  });
});
