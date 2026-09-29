import {
  AccessRequestEnvelope,
  AccessRequestList,
  EventsResponse,
  HealthReportResponse,
  PairResponse,
  PolicyEnvelope,
  type EventsReport,
  type HealthReport,
  type PairRequest,
} from "@eguard/schemas";
import type { HttpClient } from "./http.ts";
import type { TokenManager } from "./token-manager.ts";
import { PATHS } from "./paths.ts";

/** Exchange a one-time pairing code from the parent dashboard for installation credentials. */
export function pair(http: HttpClient, body: PairRequest) {
  return http.request(PATHS.pair, PairResponse, { body });
}

/** The family's current policy for this installation, with eGuard's signature. The caller verifies it. */
export function fetchPolicy(tokens: TokenManager) {
  return tokens.authorized(PATHS.policy, PolicyEnvelope);
}

/** The child asks a parent to open a blocked site (`domain` is the host they tried). */
export function createAccessRequest(
  tokens: TokenManager,
  body: { domain: string; reason?: string | undefined },
) {
  return tokens.authorized(PATHS.accessRequests, AccessRequestEnvelope, { body });
}

/** This browser's recent requests and their answers. */
export function listAccessRequests(tokens: TokenManager) {
  return tokens.authorized(PATHS.accessRequests, AccessRequestList);
}

/** The extension's self-checks, so eGuard can tell parents when protection changes. */
export function reportHealth(tokens: TokenManager, body: HealthReport) {
  return tokens.authorized(PATHS.healthReport, HealthReportResponse, { body });
}

/** One day's blocked counts per category. */
export function reportEvents(tokens: TokenManager, body: EventsReport) {
  return tokens.authorized(PATHS.events, EventsResponse, { body });
}
