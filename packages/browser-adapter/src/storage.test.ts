import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { memoryArea, typedItem } from "./storage.ts";

const Schema = z.object({ version: z.number().int().positive() });

describe("typedItem", () => {
  it("round-trips valid values", async () => {
    const item = typedItem(memoryArea(), "policy", Schema);
    expect(await item.get()).toBeNull();
    await item.set({ version: 3 });
    expect(await item.get()).toEqual({ version: 3 });
    await item.remove();
    expect(await item.get()).toBeNull();
  });

  it("treats tampered or outdated values as missing, and reports them", async () => {
    const area = memoryArea();
    await area.set({ policy: { version: "3; drop" } });
    const onInvalid = vi.fn();
    expect(await typedItem(area, "policy", Schema, onInvalid).get()).toBeNull();
    expect(onInvalid).toHaveBeenCalledWith("policy", expect.any(String));
  });

  it("refuses to write invalid values", async () => {
    const item = typedItem(memoryArea(), "policy", Schema);
    await expect(item.set({ version: -1 })).rejects.toThrow();
  });

  it("returns copies, so callers can't mutate stored state", async () => {
    const area = memoryArea();
    const item = typedItem(area, "policy", Schema);
    await item.set({ version: 1 });
    const v = (await item.get())!;
    v.version = 99;
    expect(await item.get()).toEqual({ version: 1 });
  });
});
