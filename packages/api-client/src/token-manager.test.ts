import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createHttpClient } from "./http.ts";
import {
  REFRESH_RETRY_DELAYS_MS,
  REVOKE_CONFIRM_MS,
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
  const tm = createTokenManager({ http, store, now: () => clock.t, sleep, onRevoked });
  return { tm, calls: f.calls, onRevoked, sleep };
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

  it("forgets credentials once when the backend says the installation was removed", async () => {
    for (const code of REVOKED_CODES) {
      const store = memoryStore({ installationId: "bi_1", refreshToken: tok("rt0") });
      const { tm, onRevoked } = setup(
        { "/api/browser/v1/token": () => ({ status: 401, json: { error: "Removed", code } }) },
        store,
      );
      expect(await tm.accessToken()).toMatchObject({ ok: false, kind: "unauthorized" });
      expect(store.cred).toBeNull();
      expect(onRevoked).toHaveBeenCalledTimes(1);
    }
  });

  it("doesn't forget the browser on a bare 401 until /token keeps refusing it (a server fault isn't a removal)", async () => {
    const store = memoryStore({ installationId: "bi_1", refreshToken: tok("rt0") });
    const clock = { t: NOW };
    const { tm, onRevoked, calls } = setup(
      { "/api/browser/v1/token": () => ({ status: 401, json: { error: "x", code: "unauthorized" } }) },
      store,
      clock,
    );
    expect(await tm.accessToken()).toMatchObject({ ok: false, kind: "unauthorized" });
    expect(store.cred).toMatchObject({ refreshToken: tok("rt0"), rejectedSince: later(0) });
    clock.t = NOW + REVOKE_CONFIRM_MS - 1;
    await tm.accessToken();
    expect(onRevoked).not.toHaveBeenCalled();
    // Only the credential itself goes to the server, never the bookkeeping
    expect(calls.every((c) => Object.keys(c.body as object).length === 2)).toBe(true);

    clock.t = NOW + REVOKE_CONFIRM_MS;
    await tm.accessToken();
    expect(store.cred).toBeNull();
    expect(onRevoked).toHaveBeenCalledTimes(1);
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
