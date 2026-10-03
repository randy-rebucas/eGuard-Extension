/**
 * A stand-in for the eGuard backend's /api/browser/v1 endpoints (docs/API.md), for fast, deterministic runs.
 * It also serves a plain page for any other path, so mapped hosts (*.example → here) load like real websites.
 * tests/e2e/real-backend.spec.ts covers the real server.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { canonicalJson } from "@eguard/policy-engine";

/** Signs like ~/eguard/src/lib/browser-policy.ts, with the key global-setup built into the extension. */
function signed(p: object) {
  const raw = process.env.E2E_POLICY_PRIVATE_KEY;
  if (!raw) throw new Error("E2E_POLICY_PRIVATE_KEY not set (global-setup)");
  const key = createPrivateKey({ key: Buffer.from(raw, "base64"), format: "der", type: "pkcs8" });
  const signature = sign("sha256", Buffer.from(canonicalJson(p)), {
    key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64");
  return { policy: p, signature, keyId: "e2e" };
}

export type MockState = {
  codes: Set<string>;
  /** Drop every API connection (simulates the backend being unreachable). */
  down: boolean;
  /** Parent removed the browser: all tokens stop working. */
  revoked: boolean;
  policyVersion: number;
  /** Merged into the served policy: tests change what the "parent" set. */
  policyPatch: Record<string, unknown>;
  accessRequests: {
    id: string;
    domain: string;
    reason: string | null;
    status: "PENDING" | "APPROVED" | "DENIED";
  }[];
  refreshTokens: Set<string>;
  accessTokens: Set<string>;
  requests: { method: string; path: string; body: unknown }[];
};

const requestJson = (r: MockState["accessRequests"][number]) => ({
  ...r,
  duration: r.status === "APPROVED" ? "1H" : null,
  expiresAt: null,
  createdAt: new Date().toISOString(),
  decidedAt: r.status === "PENDING" ? null : new Date().toISOString(),
});

const token = (p: string) => `${p}_${randomBytes(24).toString("base64url")}`;
const INSTALLATION = "bi_e2e_1";

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function send(res: ServerResponse, status: number, json: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(json));
}

function grant(s: MockState) {
  const accessToken = token("at");
  const refreshToken = token("rt");
  s.accessTokens.add(accessToken);
  s.refreshTokens.add(refreshToken);
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}

export function policy(version: number, patch: Record<string, unknown> = {}) {
  return {
    id: "pol_e2e",
    childId: "child_mia",
    installationId: INSTALLATION,
    version,
    safeBrowsing: true,
    safeSearch: true,
    blockedCategories: ["ADULT", "GAMING"],
    blockedDomains: ["blocked.example"],
    allowedDomains: ["school.example"],
    unknownSitesPolicy: "ALLOW",
    schedule: null,
    temporaryAllows: [],
    categoryDomains: { GAMING: ["play.example"] },
    updatedAt: new Date().toISOString(),
    ...patch,
  };
}

export async function startMockBackend(port: number) {
  const state: MockState = {
    codes: new Set(["824917"]),
    down: false,
    revoked: false,
    policyVersion: 1,
    policyPatch: {},
    accessRequests: [],
    refreshTokens: new Set(),
    accessTokens: new Set(),
    requests: [],
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (!url.pathname.startsWith("/api/")) {
        // Any other path is "a website"; with host mapping, *.example:<port> lands here and says which host it is
        const host = (req.headers.host ?? "").replace(/:\d+$/, "");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!doctype html><title>${host}</title><h1>Welcome to ${host}</h1>`);
        return;
      }
      if (state.down) {
        req.socket.destroy();
        return;
      }
      const body = await readBody(req);
      state.requests.push({ method: req.method ?? "GET", path: url.pathname, body });
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");

      switch (`${req.method ?? ""} ${url.pathname}`) {
        case "POST /api/browser/v1/pair": {
          const code = (body as { code?: string } | null)?.code ?? "";
          if (!state.codes.delete(code)) {
            send(res, 400, { error: "Pairing code is invalid or expired", code: "invalid_code" });
            return;
          }
          send(res, 201, {
            installationId: INSTALLATION,
            familyName: "Cruz family",
            childName: "Mia",
            deviceName: "Mia's MacBook",
            ...grant(state),
          });
          return;
        }
        case "POST /api/browser/v1/token": {
          const rt = (body as { refreshToken?: string } | null)?.refreshToken ?? "";
          if (state.revoked) {
            send(res, 401, { error: "This browser was removed from eGuard.", code: "installation_revoked" });
            return;
          }
          if (!state.refreshTokens.delete(rt)) {
            send(res, 401, { error: "This browser is no longer connected to eGuard.", code: "unauthorized" });
            return;
          }
          send(res, 200, grant(state));
          return;
        }
        case "GET /api/browser/v1/policy": {
          if (state.revoked || !state.accessTokens.has(bearer)) {
            send(res, 401, { error: "Invalid or expired token" });
            return;
          }
          send(res, 200, signed(policy(state.policyVersion, state.policyPatch)));
          return;
        }
        case "POST /api/browser/v1/access-requests": {
          if (state.revoked || !state.accessTokens.has(bearer)) {
            send(res, 401, { error: "Invalid or expired token" });
            return;
          }
          const b = body as { domain: string; reason?: string };
          const r = {
            id: `req_${state.accessRequests.length + 1}`,
            domain: b.domain,
            reason: b.reason ?? null,
            status: "PENDING" as const,
          };
          state.accessRequests.push(r);
          send(res, 201, { request: requestJson(r) });
          return;
        }
        case "GET /api/browser/v1/access-requests": {
          if (state.revoked || !state.accessTokens.has(bearer)) {
            send(res, 401, { error: "Invalid or expired token" });
            return;
          }
          send(res, 200, { requests: [...state.accessRequests].reverse().map(requestJson) });
          return;
        }
        case "POST /api/browser/v1/health":
        case "POST /api/browser/v1/events": {
          if (state.revoked || !state.accessTokens.has(bearer)) {
            send(res, 401, { error: "Invalid or expired token" });
            return;
          }
          send(res, 200, { ok: true, score: 0, total: 0 });
          return;
        }
        default: {
          send(res, 404, { error: "Not found" });
          return;
        }
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    state,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
