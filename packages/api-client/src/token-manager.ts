import type { z } from "zod";
import { TokenGrant } from "@eguard/schemas";
import type { ApiResult, HttpClient, RequestOptions } from "./http.ts";
import { PATHS } from "./paths.ts";

/** Long-lived installation credential. Kept in storage.local; never contains a parent's password. */
export type InstallationCredential = { installationId: string; refreshToken: string };
/** Short-lived access token. Kept in storage.session (memory) where the browser supports it. */
export type AccessToken = { token: string; expiresAt: string };

export interface CredentialStore {
  getCredential(): Promise<InstallationCredential | null>;
  setCredential(c: InstallationCredential): Promise<void>;
  getAccess(): Promise<AccessToken | null>;
  setAccess(a: AccessToken): Promise<void>;
  /** Removes both. Called when the backend says the installation was revoked. */
  clear(): Promise<void>;
}

/** Refresh this long before expiry, to cover clock skew and slow requests. */
export const EXPIRY_SKEW_MS = 60_000;

export type TokenManagerOptions = {
  http: HttpClient;
  store: CredentialStore;
  now?: () => number;
  /** Called once when the backend rejects the refresh token (parent removed this browser). */
  onRevoked?: () => void | Promise<void>;
};

/**
 * Hands out a valid access token, refreshing it when needed.
 * Refresh tokens rotate on every use, so concurrent callers share one in-flight refresh:
 * two parallel refreshes would make the second one present an already-rotated token.
 */
export function createTokenManager({ http, store, now = Date.now, onRevoked }: TokenManagerOptions) {
  let inFlight: Promise<ApiResult<AccessToken>> | null = null;

  async function refresh(): Promise<ApiResult<AccessToken>> {
    const cred = await store.getCredential();
    if (!cred)
      return {
        ok: false,
        kind: "unauthorized",
        status: null,
        message: "This browser isn't connected to eGuard yet.",
      };
    const res = await http.request(PATHS.token, TokenGrant, { body: cred });
    if (!res.ok) {
      if (res.kind === "unauthorized") {
        await store.clear();
        await onRevoked?.();
      }
      return res;
    }
    await store.setCredential({ installationId: cred.installationId, refreshToken: res.data.refreshToken });
    const access = { token: res.data.accessToken, expiresAt: res.data.accessTokenExpiresAt };
    await store.setAccess(access);
    return { ok: true, data: access, status: res.status };
  }

  function refreshOnce() {
    inFlight ??= refresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function accessToken(): Promise<ApiResult<AccessToken>> {
    const cached = await store.getAccess();
    if (cached && Date.parse(cached.expiresAt) - EXPIRY_SKEW_MS > now())
      return { ok: true, data: cached, status: 200 };
    return refreshOnce();
  }

  /** An authenticated request. On a 401 it refreshes once and retries, then gives up. */
  async function authorized<S extends z.ZodType>(
    path: string,
    schema: S,
    ro: Omit<RequestOptions, "token"> = {},
  ): Promise<ApiResult<z.infer<S>>> {
    const first = await accessToken();
    if (!first.ok) return first;
    const res = await http.request(path, schema, { ...ro, token: first.data.token });
    if (res.ok || res.kind !== "unauthorized") return res;
    const again = await refreshOnce();
    if (!again.ok) return again;
    return http.request(path, schema, { ...ro, token: again.data.token });
  }

  return { accessToken, authorized, refresh: refreshOnce };
}

export type TokenManager = ReturnType<typeof createTokenManager>;
