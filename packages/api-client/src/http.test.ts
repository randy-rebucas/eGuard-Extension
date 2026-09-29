import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createHttpClient } from "./http.ts";
import { fakeFetch } from "./test-fetch.ts";

const Ok = z.object({ ok: z.literal(true) });

function client(
  routes: Parameters<typeof fakeFetch>[0],
  extra: Partial<Parameters<typeof createHttpClient>[0]> = {},
) {
  const f = fakeFetch(routes);
  return {
    http: createHttpClient({
      baseUrl: "https://api.test/",
      fetch: f.fetch,
      clientId: "chrome-extension",
      ...extra,
    }),
    calls: f.calls,
  };
}

describe("http client", () => {
  it("parses responses against the contract and sends auth + client headers", async () => {
    const { http, calls } = client({ "/x": () => ({ status: 200, json: { ok: true } }) });
    const res = await http.request("/x", Ok, { token: "tok_abcdefghijklmnopqrstuvwxyz", body: { a: 1 } });
    expect(res).toEqual({ ok: true, data: { ok: true }, status: 200 });
    expect(calls[0]?.headers).toMatchObject({
      Authorization: "Bearer tok_abcdefghijklmnopqrstuvwxyz",
      "X-eGuard-Client": "chrome-extension",
      "Content-Type": "application/json",
    });
  });

  it("shows the server's parent-safe text for 4xx", async () => {
    const { http } = client({
      "/pair": () => ({ status: 400, json: { error: "Pairing code is invalid or expired" } }),
    });
    expect(await http.request("/pair", Ok, { body: {} })).toMatchObject({
      ok: false,
      kind: "rejected",
      message: "Pairing code is invalid or expired",
    });
  });

  it("never shows server text for 5xx", async () => {
    const { http } = client({
      "/x": () => ({ status: 500, json: { error: "TypeError: at prisma.device.findUnique" } }),
    });
    const res = await http.request("/x", Ok);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe("server");
      expect(res.message).not.toContain("prisma");
    }
  });

  it("classifies 401, 403 and 429", async () => {
    const { http } = client({
      "/a": () => ({ status: 401, json: { error: "x" } }),
      "/b": () => ({ status: 403 }),
      "/c": () => ({ status: 429, json: { error: "Too many attempts." } }),
    });
    expect(await http.request("/a", Ok)).toMatchObject({ kind: "unauthorized" });
    expect(await http.request("/b", Ok)).toMatchObject({ kind: "forbidden" });
    expect(await http.request("/c", Ok)).toMatchObject({
      kind: "rate_limited",
      message: "Too many attempts.",
    });
  });

  it("rejects 2xx responses that break the contract", async () => {
    const { http } = client({ "/x": () => ({ status: 200, json: { ok: "yes" } }) });
    expect(await http.request("/x", Ok)).toMatchObject({ ok: false, kind: "invalid_response" });
  });

  it("reports network failures and timeouts without throwing", async () => {
    const { http } = client({ "/x": () => "network-error" });
    expect(await http.request("/x", Ok)).toMatchObject({ ok: false, kind: "network", status: null });

    const slow = createHttpClient({
      baseUrl: "https://api.test",
      timeoutMs: 10,
      fetch: (_: unknown, init?: RequestInit) =>
        new Promise((_r, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
        ),
    });
    expect(await slow.request("/x", Ok)).toMatchObject({ ok: false, kind: "timeout" });
  });
});
