/**
 * Policies are signed by the eGuard server (ECDSA P-256, SHA-256) over their canonical JSON, and verified
 * here with WebCrypto, which every supported browser has. ~/eguard/src/lib/browser-policy.ts signs; the two
 * canonicalJson implementations must stay byte-for-byte identical (both repos test the same vector).
 */

/** JSON with object keys sorted at every level and no whitespace. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(canonical(v));
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, canonical(o[k])]),
    );
  }
  return v;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;

/** Imports the public key baked into the build (base64 SPKI DER). */
export function importPolicyKey(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", base64ToBytes(spkiBase64), ALG, false, ["verify"]);
}

/**
 * Imports every key the build trusts: VITE_POLICY_PUBLIC_KEY holds one base64 SPKI, or several separated by commas
 * during a key rotation (old and new), so policies signed with either verify. A key that fails to import is
 * skipped and reported through `onInvalid`.
 */
export async function importPolicyKeys(
  list: string,
  onInvalid?: (index: number, err: unknown) => void,
): Promise<CryptoKey[]> {
  const parts = list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const keys = await Promise.all(
    parts.map((p, i) =>
      importPolicyKey(p).catch((err: unknown) => {
        onInvalid?.(i, err);
        return null;
      }),
    ),
  );
  return keys.filter((k): k is CryptoKey => k !== null);
}

/** True when any trusted key verifies `signature` over this policy. */
export async function verifyWithAnyKey(
  keys: CryptoKey[],
  policy: unknown,
  signature: string,
): Promise<boolean> {
  for (const key of keys) if (await verifyPolicySignature(key, policy, signature)) return true;
  return false;
}

/** True only when `signature` (base64, raw r||s) is eGuard's signature over exactly this policy. */
export async function verifyPolicySignature(
  key: CryptoKey,
  policy: unknown,
  signature: string,
): Promise<boolean> {
  try {
    const sig = base64ToBytes(signature);
    if (sig.length !== 64) return false;
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sig,
      new TextEncoder().encode(canonicalJson(policy)),
    );
  } catch {
    return false;
  }
}
