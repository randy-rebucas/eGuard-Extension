/** Browser-extension API, next to the existing /api/device/v1 and /api/mobile/v1. See docs/API.md. */
export const PATHS = {
  pair: "/api/browser/v1/pair",
  token: "/api/browser/v1/token",
  policy: "/api/browser/v1/policy",
  healthReport: "/api/browser/v1/health",
  accessRequests: "/api/browser/v1/access-requests",
  events: "/api/browser/v1/events",
} as const;
