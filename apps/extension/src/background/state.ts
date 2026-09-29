import { z } from "zod";
import { typedItem, type StorageAreaLike } from "@eguard/browser-adapter";
import type { CredentialStore } from "@eguard/api-client";
import { BrowserProtectionPolicy } from "@eguard/schemas";

export const Installation = z.object({
  installationId: z.string().min(1),
  familyName: z.string(),
  childName: z.string(),
  deviceName: z.string(),
  pairedAt: z.iso.datetime(),
});
export type Installation = z.infer<typeof Installation>;

/** Stored with eGuard's signature, which is checked again every time the policy is read. */
export const StoredPolicy = z.object({
  policy: BrowserProtectionPolicy,
  signature: z.string().min(1),
  keyId: z.string(),
  receivedAt: z.iso.datetime(),
});
export type StoredPolicy = z.infer<typeof StoredPolicy>;

export const SyncRecord = z.object({
  lastAttemptAt: z.iso.datetime().nullable(),
  lastSuccessAt: z.iso.datetime().nullable(),
  lastError: z.object({ kind: z.string(), message: z.string(), at: z.iso.datetime() }).nullable(),
});
export type SyncRecord = z.infer<typeof SyncRecord>;

export const HealthRecord = z.object({ lastCheckAt: z.iso.datetime() });

const Credential = z.object({ installationId: z.string().min(1), refreshToken: z.string().min(20) });
const Access = z.object({ token: z.string().min(20), expiresAt: z.iso.datetime() });

/**
 * Everything the worker persists. `local` survives restarts; `session` (access token only) is
 * held in memory by the browser and cleared when it closes. No browsing data is stored here.
 */
export function createState(
  local: StorageAreaLike,
  session: StorageAreaLike,
  onInvalid?: (key: string, issue: string) => void,
) {
  const items = {
    installation: typedItem(local, "installation", Installation, onInvalid),
    credential: typedItem(local, "credential", Credential, onInvalid),
    policy: typedItem(local, "policy", StoredPolicy, onInvalid),
    sync: typedItem(local, "sync", SyncRecord, onInvalid),
    health: typedItem(local, "health", HealthRecord, onInvalid),
    access: typedItem(session, "access", Access, onInvalid),
  };

  const credentials: CredentialStore = {
    getCredential: () => items.credential.get(),
    setCredential: (c) => items.credential.set(c),
    getAccess: () => items.access.get(),
    setAccess: (a) => items.access.set(a),
    clear: async () => {
      await items.credential.remove();
      await items.access.remove();
    },
  };

  /** The parent removed this browser from eGuard: forget the connection and its policy. */
  async function forgetInstallation() {
    await credentials.clear();
    await Promise.all([
      items.installation.remove(),
      items.policy.remove(),
      items.sync.remove(),
      items.health.remove(),
    ]);
  }

  return { ...items, credentials, forgetInstallation };
}

export type State = ReturnType<typeof createState>;
