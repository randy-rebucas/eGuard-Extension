import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createHttpClient } from "./http.ts";
import {
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

function setup(routes: Parameters<typeof fakeFetch>[0], store: ReturnType<typeof memoryStore>) {
  const f = fakeFetch(routes);
  const onRevoked = vi.fn();
  const http = createHttpClient({ baseUrl: "https://api.test", fetch: f.fetch });
  const tm = createTokenManager({ http, store, now: () => NOW, onRevoked });
  return { tm, calls: f.calls, onRevoked };
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

  it("forgets credentials once when the backend revokes the installation", async () => {
    const store = memoryStore({ installationId: "bi_1", refreshToken: tok("rt0") });
    const { tm, onRevoked } = setup(
      { "/api/browser/v1/token": () => ({ status: 401, json: { error: "Revoked" } }) },
      store,
    );
    expect(await tm.accessToken()).toMatchObject({ ok: false, kind: "unauthorized" });
    expect(store.cred).toBeNull();
    expect(onRevoked).toHaveBeenCalledTimes(1);
  });

  it("keeps credentials when the refresh merely fails to reach the server", async () => {
    const store = memoryStore({ installationId: "bi_1", refreshToken: tok("rt0") });
    const { tm, onRevoked } = setup({ "/api/browser/v1/token": () => "network-error" }, store);
    expect(await tm.accessToken()).toMatchObject({ ok: false, kind: "network" });
    expect(store.cred).not.toBeNull();
    expect(onRevoked).not.toHaveBeenCalled();
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
