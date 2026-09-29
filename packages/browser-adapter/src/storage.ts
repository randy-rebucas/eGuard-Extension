import type { z } from "zod";

/** The part of chrome.storage.StorageArea / browser.storage.StorageArea we rely on. */
export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface TypedItem<T> {
  readonly key: string;
  get(): Promise<T | null>;
  set(value: T): Promise<void>;
  remove(): Promise<void>;
}

/**
 * A single storage key with a schema. Values are validated on the way in and on the way out:
 * anything malformed (a bug, an older format, or tampering) reads back as "missing", and is
 * reported through `onInvalid` so it can be logged, never silently trusted.
 */
export function typedItem<S extends z.ZodType>(
  area: StorageAreaLike,
  key: string,
  schema: S,
  onInvalid?: (key: string, issue: string) => void,
): TypedItem<z.infer<S>> {
  return {
    key,
    async get() {
      const raw = (await area.get(key))[key];
      if (raw === undefined) return null;
      const parsed = schema.safeParse(raw);
      if (parsed.success) return parsed.data;
      onInvalid?.(key, parsed.error.issues[0]?.message ?? "invalid");
      return null;
    },
    async set(value) {
      await area.set({ [key]: schema.parse(value) });
    },
    async remove() {
      await area.remove(key);
    },
  };
}

/** In-memory area, for tests and for browsers without storage.session. Cleared when the worker stops. */
export function memoryArea(): StorageAreaLike & { dump(): Record<string, unknown> } {
  const data = new Map<string, unknown>();
  const keysOf = (k: string | string[]) => (Array.isArray(k) ? k : [k]);
  return {
    async get(keys) {
      const out: Record<string, unknown> = {};
      for (const k of keysOf(keys)) if (data.has(k)) out[k] = structuredClone(data.get(k));
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
    async remove(keys) {
      for (const k of keysOf(keys)) data.delete(k);
    },
    dump: () => Object.fromEntries(data),
  };
}
