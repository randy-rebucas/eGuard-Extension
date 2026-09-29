import { describe, expect, it } from "vitest";
import type { BrowserInfo } from "@eguard/schemas";
import { SYNC_STALE_MS, deriveStatus, type StatusInput } from "./status.ts";

const NOW = Date.parse("2026-09-29T10:00:00Z");
const chrome: BrowserInfo = { family: "chrome", name: "Chrome", version: "153.0.0.0", major: 153 };
const installation = {
  installationId: "bi_1",
  familyName: "Cruz family",
  childName: "Mia",
  deviceName: "Mia's MacBook",
  pairedAt: "2026-09-29T09:00:00.000Z",
};
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function input(p: Partial<StatusInput> = {}): StatusInput {
  return {
    browser: chrome,
    supported: true,
    installation,
    policyVersion: 42,
    rulesVerified: true,
    privateWindowsAllowed: true,
    sync: { lastAttemptAt: ago(60_000), lastSuccessAt: ago(60_000), lastError: null },
    lastHealthCheckAt: null,
    now: NOW,
    ...p,
  };
}

describe("deriveStatus", () => {
  it("is PROTECTED only with a policy, verified rules and a recent sync", () => {
    expect(deriveStatus(input()).state).toBe("PROTECTED");
    expect(deriveStatus(input()).issues).toEqual([]);
  });

  it("never reports PROTECTED when the rules aren't verified", () => {
    const s = deriveStatus(input({ rulesVerified: false }));
    expect(s.state).toBe("NEEDS_ATTENTION");
    expect(s.issues[0]).toMatchObject({ id: "rules-not-active", status: "WARNING" });
  });

  it("asks for connection when the browser isn't paired", () => {
    const s = deriveStatus(input({ installation: null, policyVersion: null }));
    expect(s.state).toBe("ACTION_REQUIRED");
    expect(s.connection).toEqual({ paired: false });
    expect(s.issues[0]?.action).toBe("CONNECT");
  });

  it("waits for the first policy after pairing, mentioning a failed download", () => {
    const waiting = deriveStatus(input({ policyVersion: null, sync: null }));
    expect(waiting.state).toBe("ACTION_REQUIRED");
    expect(waiting.issues[0]?.action).toBe("SYNC_NOW");

    const failing = deriveStatus(
      input({
        policyVersion: null,
        sync: {
          lastAttemptAt: ago(0),
          lastSuccessAt: null,
          lastError: { kind: "network", message: "offline", at: ago(0) },
        },
      }),
    );
    expect(failing.summary).toMatch(/couldn't download/);
    expect(failing.issues[0]?.detail).toBe("offline");
  });

  it("says sync is paused (and protection still active) when offline", () => {
    const s = deriveStatus(
      input({
        sync: {
          lastAttemptAt: ago(0),
          lastSuccessAt: ago(3_600_000),
          lastError: { kind: "network", message: "No internet", at: ago(0) },
        },
      }),
    );
    expect(s.state).toBe("SYNC_PAUSED");
    expect(s.summary).toMatch(/version 42\) is still active/);
    expect(s.lastSyncAt).toBe(ago(3_600_000));
  });

  it("treats a long silence as paused sync even without an error", () => {
    const s = deriveStatus(
      input({ sync: { lastAttemptAt: null, lastSuccessAt: ago(SYNC_STALE_MS + 1), lastError: null } }),
    );
    expect(s.state).toBe("SYNC_PAUSED");
  });

  it("does not call a rejected policy 'offline'", () => {
    const s = deriveStatus(
      input({
        sync: {
          lastAttemptAt: ago(0),
          lastSuccessAt: ago(60_000),
          lastError: { kind: "invalid_response", message: "bad", at: ago(0) },
        },
      }),
    );
    expect(s.state).toBe("PROTECTED");
  });

  it("reports unsupported browsers without claiming anything", () => {
    const safari: BrowserInfo = { family: "safari", name: "Safari", version: "19.0", major: 19 };
    const s = deriveStatus(input({ browser: safari, supported: false }));
    expect(s.state).toBe("UNSUPPORTED");
    expect(s.summary).toContain("Safari 19");
  });

  it("passes connection details through for display", () => {
    expect(deriveStatus(input()).connection).toMatchObject({
      paired: true,
      childName: "Mia",
      familyName: "Cruz family",
    });
  });

  it("isn't PROTECTED while private windows get around the rules", () => {
    const off = deriveStatus(input({ privateWindowsAllowed: false }));
    expect(off.state).toBe("NEEDS_ATTENTION");
    expect(off.summary).toMatch(/normal windows, but not in private/);
    expect(off.issues[0]).toMatchObject({ id: "private-windows", status: "WARNING" });
    expect(off.issues[0]?.detail).toMatch(/chrome:\/\/extensions.*Allow in Incognito/);

    const unknown = deriveStatus(input({ privateWindowsAllowed: null }));
    expect(unknown.state).toBe("NEEDS_ATTENTION");
    expect(unknown.issues[0]?.detail).toMatch(/can't check/);
  });

  it("gives each browser its own private-window steps", () => {
    const firefox = { family: "firefox" as const, name: "Firefox", version: "143.0", major: 143 };
    const edge = { family: "edge" as const, name: "Edge", version: "154", major: 154 };
    expect(deriveStatus(input({ browser: firefox, privateWindowsAllowed: false })).issues[0]?.detail).toMatch(
      /Run in Private Windows/,
    );
    expect(deriveStatus(input({ browser: edge, privateWindowsAllowed: false })).issues[0]?.detail).toMatch(
      /InPrivate/,
    );
  });

  it("reports sync paused and private windows together", () => {
    const s = deriveStatus(
      input({
        privateWindowsAllowed: false,
        sync: {
          lastAttemptAt: ago(0),
          lastSuccessAt: ago(3_600_000),
          lastError: { kind: "network", message: "offline", at: ago(0) },
        },
      }),
    );
    expect(s.state).toBe("SYNC_PAUSED");
    expect(s.issues.map((i) => i.id)).toEqual(["sync-paused", "private-windows"]);
  });
});
