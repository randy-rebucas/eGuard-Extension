import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createHttpClient } from "./http.ts";
import {
  REFRESH_RETRY_DELAYS_MS,
  REVOKED_CODES,
  createTokenManager,
  type AccessToken,
  type CredentialStore,
  type InstallationCredential,
} from "./token-manager.ts";
import { fakeFetch, type Handler } from "./test-fetch.ts";

const NOW = Date.parse("2026-09-29T10:00:00Z");
const later = (ms: number) => new Date(NOW + ms).toISOString();
const tok = (s: string) => `${s}_${"x".repeat(24)}`;

function memoryStore(
  cred: InstallationCredential | null,
  access: AccessToken | null = null,
): CredentialStore & { cred: InstallationCredential | null; access: AccessToken | null } {
  const s = {
    cred,
    access,
    getCredential: async () => s.cred,
    setCredential: async (c: InstallationCredential) => void (s.cred = c),
    getAccess: async () => s.access,
    setAccess: async (a: AccessToken) => void (s.access = a),
    clear: async () => {
      s.cred = null;
      s.access = null;
    },
  };
  return s;
}

const grant =
  (n: number): Handler =>
  () => ({
    status: 200,
    json: {
      accessToken: tok(`at${n}`),
      accessTokenExpiresAt: later(15 * 60_000),
      refreshToken: tok(`rt${n}`),
    },
  });

function setup(
  routes: Parameters<typeof fakeFetch>[0],
  store: ReturnType<typeof memoryStore>,
  clock = { t: NOW },
) {
  const f = fakeFetch(routes);
  const onRevoked = vi.fn();
  const http = createHttpClient({ baseUrl: "https://api.test", fetch: f.fetch });
  const sleep = vi.fn(async (_ms: number) => {});
  // Stands in for the signature check (policy-engine verifyWithAnyKey, tested there)
  const verifyRevocation = async (p: { signature: string }) => p.signature === "good";
  const tm = createTokenManager({ http, store, now: () => clock.t, sleep, verifyRevocation, onRevoked });
  return { tm, calls: f.calls, onRevoked, sleep };
}

/** /token's signed revocation for bi_1, as the server sends it. */
function proof(o: { signature?: string; installationId?: string; type?: string } = {}) {
  return {
    revocation: {
      type: o.type ?? "eguard.browser.revoked",
      installationId: o.installationId ?? "bi_1",
      at: later(0),
    },
    signature: o.signature ?? "good",
    keyId: "k",
  };
}

describe("token manager", () => {
  it("uses a cached access token while it is fresh", async () => {
    const store = memoryStore(
      { installationId: "bi_1", refreshToken: tok("rt0") },
      { token: tok("at0"), expiresAt: later(10 * 60_000) },
    );
    const { tm, calls } = setup({}, store);
    expect(await tm.accessToken()).toMatchObject({ ok: true, data: { token: tok("at0") } });
    expect(calls).toHaveLength(0);
  });

  it("refreshes near expiry and stores the rotated refresh token", async () => {
    const store = memoryStore(
      { installationId: "bi_1", refreshToken: tok("rt0") },
      { token: tok("at0"), expiresAt: later(30_000) },
    );
    const { tm, calls } = setup({ "/api/browser/v1/token": grant(1) }, store);
    expect(await tm.accessToken()).toMatchObject({ ok: true, data: { token: tok("at1") } });
    expect(calls[0]?.body).toEqual({ installationId: "bi_1", refreshToken: tok("rt0") });
    expect(store.cred?.refreshToken).toBe(tok("rt1"));
  });

  it("shares one refresh between concurrent callers (rotation-safe)", async () => {
    const store = memoryStore({ installationId: "bi_1", refreshToken: tok("rt0") });
    const { tm, calls } = setup({ "/api/browser/v1/token": [grant(1), grant(2)] }, store);
    const results = await Promise.all([tm.accessToken(), tm.accessToken(), tm.accessToken()]);
    expect(calls).toHaveLength(1);
    expect(results.every((r) => r.ok && r.data.token === tok("at1"))).toBe(true);
  });

  it("forgets credentials once when the backend says, with its signature, that the installation was removed", async () => {
    for (const code of REVOKED_CODES) {
      const store = memoryStore({ installationId: "bi_1", refreshToken: tok("rt0") });
      const { tm, onRevoked } = setup(
        {
          "/api/browser/v1/token": () => ({
            status: 401,
            json: { error: "Removed", code, revocation: proof() },
          }),
        },
        store,
      );
      expect(await tm.accessToken()).toMatchObject({ ok: false, kind: "unauthorized" });
      expect(store.cred).toBeNull();
      expect(onRevoked).toHaveBeenCalledTimes(1);
    }
  });

  it("never forgets the browser on a 401 without eGuard's signed revocation for it (a proxy could send one)", async () => {
    const answers = [
      { error: "x", code: "unauthorized" },
      { error: "Removed", code: "installation_revoked" },
      { error: "Removed", code: "installation_revoked", revocation: proof({ signature: "forged" }) },
      { error: "Removed", code: "installation_revoked", revocation: proof({ installationId: "bi_other" }) },
      { error: "Removed", code: "installation_revoked", revocation: proof({ type: "eguard.policy" }) },
      // A real signature, but on an answer that doesn't say the browser was removed
      { error: "x", code: "unauthorized", revocation: proof() },
    ];
    for (const json of answers) {
      const store = memoryStore({ installationId: "bi_1", refreshToken: tok("rt0") });
      const clock = { t: NOW };
      const { tm, onRevoked, calls } = setup(
        { "/api/browser/v1/token": () => ({ status: 401, json }) },
        store,
        clock,
      );
      expect(await tm.accessToken()).toMatchObject({ ok: false, kind: "unauthorized" });
      expect(store.cred).toMatchObject({ refreshToken: tok("rt0"), rejectedSince: later(0) });
      clock.t = NOW + 24 * 3600_000;
      await tm.accessToken();
      expect(onRevoked, JSON.stringify(json)).not.toHaveBeenCalled();
      expect(store.cred).not.toBeNull();
      // Only the credential itself goes to the server, never the bookkeeping
      expect(calls.every((c) => Object.keys(c.body as object).length === 2)).toBe(true);
    }
  });

  it("clears an unconfirmed refusal once a refresh works again", async () => {
    const store = memoryStore({ installationId: "bi_1", refreshToken: tok("rt0") });
    const { tm } = setup(
      { "/api/browser/v1/token": [() => ({ status: 401, json: { error: "x" } }), grant(1)] },
      store,
    );
    await tm.accessToken();
    expect(store.cred?.rejectedSince).toBeDefined();
    expect(await tm.accessToken()).toMatchObject({ ok: true });
    expect(store.cred).toEqual({ installationId: "bi_1", refreshToken: tok("rt1") });
  });

  it("keeps credentials when the refresh merely fails to reach the server", async () => {
    const store = memoryStore({ installationId: "bi_1", refreshToken: tok("rt0") });
    const { tm, onRevoked, calls } = setup({ "/api/browser/v1/token": () => "network-error" }, store);
    expect(await tm.accessToken()).toMatchObject({ ok: false, kind: "network" });
    expect(calls).toHaveLength(1 + REFRESH_RETRY_DELAYS_MS.length);
    expect(store.cred).not.toBeNull();
    expect(onRevoked).not.toHaveBeenCalled();
  });

  it("re-sends a lost refresh at once, inside the server's 2-minute replay window", async () => {
    const store = memoryStore({ installationId: "bi_1", refreshToken: tok("rt0") });
    const { tm, calls, sleep } = setup(
      { "/api/browser/v1/token": [() => "network-error", () => ({ status: 503 }), grant(1)] },
      store,
    );
    expect(await tm.accessToken()).toMatchObject({ ok: true, data: { token: tok("at1") } });
    // Every attempt presents the same (previous) refresh token; the server answers it with fresh tokens
    expect(calls.map((c) => c.body)).toEqual(
      Array(3).fill({ installationId: "bi_1", refreshToken: tok("rt0") }),
    );
    expect(sleep.mock.calls.flat().reduce((a, b) => a + b, 0)).toBeLessThan(60_000);
    expect(store.cred?.refreshToken).toBe(tok("rt1"));
  });

  it("doesn't retry a refresh the server refused or rate-limited", async () => {
    const store = memoryStore({ installationId: "bi_1", refreshToken: tok("rt0") });
    const { tm, calls } = setup(
      {
        "/api/browser/v1/token": () => ({ status: 429, json: { error: "Slow down", code: "rate_limited" } }),
      },
      store,
    );
    expect(await tm.accessToken()).toMatchObject({ ok: false, kind: "rate_limited" });
    expect(calls).toHaveLength(1);
  });

  it("retries an authorized request once after a 401", async () => {
    const store = memoryStore(
      { installationId: "bi_1", refreshToken: tok("rt0") },
      { token: tok("stale"), expiresAt: later(10 * 60_000) },
    );
    const { tm, calls } = setup(
      {
        "/api/browser/v1/token": grant(1),
        "/api/browser/v1/policy": [() => ({ status: 401 }), () => ({ status: 200, json: { v: 1 } })],
      },
      store,
    );
    const res = await tm.authorized("/api/browser/v1/policy", z.object({ v: z.number() }));
    expect(res).toMatchObject({ ok: true, data: { v: 1 } });
    expect(calls.map((c) => c.path)).toEqual([
      "/api/browser/v1/policy",
      "/api/browser/v1/token",
      "/api/browser/v1/policy",
    ]);
    expect(calls[2]?.headers.Authorization).toBe(`Bearer ${tok("at1")}`);
  });

  it("reports not-connected without calling the server", async () => {
    const { tm, calls } = setup({}, memoryStore(null));
    expect(await tm.accessToken()).toMatchObject({ ok: false, kind: "unauthorized" });
    expect(calls).toHaveLength(0);
  });
});
