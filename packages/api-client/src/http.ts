import type { z } from "zod";
import { ApiErrorBody } from "@eguard/schemas";

export type FailureKind =
  | "network" // backend unreachable (offline, DNS, CORS)
  | "timeout"
  | "unauthorized" // 401: credentials revoked or expired
  | "forbidden"
  | "rate_limited"
  | "rejected" // other 4xx: the server refused the request (message is safe to show)
  | "server" // 5xx
  | "invalid_response"; // 2xx that didn't match the contract

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; kind: FailureKind; status: number | null; message: string; code?: string | undefined };

export type HttpClientOptions = {
  /** API origin, e.g. https://www.eguard.family. Paths are appended as-is. */
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Sent as X-eGuard-Client, like the mobile apps (history then reads "… on Chrome extension"). */
  clientId?: string;
  onDiagnostic?: (event: string, detail: Record<string, unknown>) => void;
};

export type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
};

/** Messages people see. Server-provided `error` text is shown for 4xx because the backend writes it for parents. */
const FRIENDLY: Record<FailureKind, string> = {
  network: "We couldn't reach eGuard. Check the internet connection.",
  timeout: "eGuard took too long to answer. Try again in a moment.",
  unauthorized: "This browser is no longer connected to eGuard.",
  forbidden: "This browser isn't allowed to do that.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  rejected: "eGuard couldn't complete that request.",
  server: "eGuard is having trouble right now. Your last protection settings stay active.",
  invalid_response: "eGuard sent an unexpected answer. Your last protection settings stay active.",
};

export function friendlyMessage(kind: FailureKind): string {
  return FRIENDLY[kind];
}

export function createHttpClient(opts: HttpClientOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const base = opts.baseUrl.replace(/\/+$/, "");

  async function request<S extends z.ZodType>(
    path: string,
    schema: S,
    ro: RequestOptions = {},
  ): Promise<ApiResult<z.infer<S>>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (ro.body !== undefined) headers["Content-Type"] = "application/json";
    if (ro.token) headers.Authorization = `Bearer ${ro.token}`;
    if (opts.clientId) headers["X-eGuard-Client"] = opts.clientId;

    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = ro.signal ? AbortSignal.any([ro.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: ro.method ?? (ro.body === undefined ? "GET" : "POST"),
        headers,
        body: ro.body === undefined ? undefined : JSON.stringify(ro.body),
        signal,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      });
    } catch (err) {
      const kind: FailureKind = timeout.aborted ? "timeout" : "network";
      opts.onDiagnostic?.("http_failure", { path, kind, error: String(err) });
      return { ok: false, kind, status: null, message: FRIENDLY[kind] };
    }

    let json: unknown;
    try {
      json = res.status === 204 ? null : await res.json();
    } catch {
      json = null;
    }

    if (res.ok) {
      const parsed = schema.safeParse(json);
      if (parsed.success) return { ok: true, data: parsed.data, status: res.status };
      opts.onDiagnostic?.("contract_mismatch", {
        path,
        status: res.status,
        issue: parsed.error.issues[0]?.message,
      });
      return { ok: false, kind: "invalid_response", status: res.status, message: FRIENDLY.invalid_response };
    }

    const body = ApiErrorBody.safeParse(json);
    const kind: FailureKind =
      res.status === 401
        ? "unauthorized"
        : res.status === 403
          ? "forbidden"
          : res.status === 429
            ? "rate_limited"
            : res.status >= 500
              ? "server"
              : "rejected";
    const serverText = body.success && kind !== "server" ? body.data.error : null;
    opts.onDiagnostic?.("http_error", {
      path,
      status: res.status,
      code: body.success ? body.data.code : undefined,
    });
    return {
      ok: false,
      kind,
      status: res.status,
      message: serverText ?? FRIENDLY[kind],
      code: body.success ? body.data.code : undefined,
    };
  }

  return { request, baseUrl: base };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
