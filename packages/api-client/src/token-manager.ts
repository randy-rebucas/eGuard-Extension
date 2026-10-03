import type { z } from "zod";
import { TokenGrant } from "@eguard/schemas";
import type { ApiResult, HttpClient, RequestOptions } from "./http.ts";
import { PATHS } from "./paths.ts";

/**
 * Long-lived installation credential. Kept in storage.local; never contains a parent's password.
 * `rejectedSince`: when /token first refused it without saying the browser was removed (see REVOKE_CONFIRM_MS).
 */
export type InstallationCredential = {
  installationId: string;
  refreshToken: string;
  rejectedSince?: string | undefined;
};
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

/**
 * Pauses before re-sending a /token request whose answer never arrived. The server may have rotated without us
 * seeing the reply; it accepts the previous refresh token again only within 2 minutes of that rotation, and after
 * that treats it as copied and disconnects the browser. So retry now, not at the next 5-minute sync. Worst case
 * (three 15 s timeouts plus these pauses) stays well inside the window.
 */
export const REFRESH_RETRY_DELAYS_MS = [2_000, 8_000] as const;
const RETRYABLE = new Set(["network", "timeout", "server"]);

/** Error codes with which /token says this browser was removed or disconnected: forget it at once. */
export const REVOKED_CODES = new Set(["installation_revoked", "token_reused"]);
/**
 * A 401 from /token without one of those codes could be a server fault, and forgetting the installation removes
 * every rule and needs a parent to pair again. So it only counts once /token has kept refusing for this long
 * (two sync rounds). Protection stays on in the meantime.
 */
export const REVOKE_CONFIRM_MS = 10 * 60_000;

export type TokenManagerOptions = {
  http: HttpClient;
  store: CredentialStore;
  now?: () => number;
  /** Waits between /token retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Called once when the backend rejects the refresh token (parent removed this browser). */
  onRevoked?: () => void | Promise<void>;
};

/**
 * Hands out a valid access token, refreshing it when needed.
 * Refresh tokens rotate on every use, so concurrent callers share one in-flight refresh:
 * two parallel refreshes would make the second one present an already-rotated token.
 */
export function createTokenManager({
  http,
  store,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  onRevoked,
}: TokenManagerOptions) {
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
    const body = { installationId: cred.installationId, refreshToken: cred.refreshToken };
    let res = await http.request(PATHS.token, TokenGrant, { body });
    for (const delay of REFRESH_RETRY_DELAYS_MS) {
      if (res.ok || !RETRYABLE.has(res.kind)) break;
      await sleep(delay);
      res = await http.request(PATHS.token, TokenGrant, { body });
    }
    if (!res.ok) {
      if (res.kind === "unauthorized") {
        const since = cred.rejectedSince ? Date.parse(cred.rejectedSince) : null;
        const confirmed =
          (res.code !== undefined && REVOKED_CODES.has(res.code)) ||
          (since !== null && now() - since >= REVOKE_CONFIRM_MS);
        if (confirmed) {
          await store.clear();
          await onRevoked?.();
        } else if (since === null) {
          await store.setCredential({ ...cred, rejectedSince: new Date(now()).toISOString() });
        }
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
