/**
 * Technical diagnostics, kept apart from anything shown to people (spec §44).
 * In memory only, capped, and never given URLs, tokens or page content.
 */
const MAX = 100;
const entries: { at: string; event: string; detail?: Record<string, unknown> }[] = [];

export function log(event: string, detail?: Record<string, unknown>) {
  entries.push({ at: new Date().toISOString(), event, ...(detail ? { detail } : {}) });
  if (entries.length > MAX) entries.shift();
  if (import.meta.env.VITE_ENVIRONMENT !== "production") console.debug("[eGuard]", event, detail ?? "");
}

export function recentDiagnostics() {
  return entries.slice();
}
