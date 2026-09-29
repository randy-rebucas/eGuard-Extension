import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CapabilityId } from "@eguard/schemas";
import { CAPABILITY_MATRIX, capabilitiesFor, renderMatrixMarkdown } from "./capabilities.ts";

describe("capability matrix", () => {
  it("covers every capability exactly once", () => {
    expect(CAPABILITY_MATRIX.map((r) => r.id).sort()).toEqual([...CapabilityId.options].sort());
  });

  it("never claims anything for Safari until it is validated", () => {
    expect(capabilitiesFor("safari").every((c) => c.level === "UNSUPPORTED")).toBe(true);
  });

  it("never marks an unsupported capability as verifiable", () => {
    for (const fam of ["chrome", "edge", "firefox", "safari"] as const) {
      for (const c of capabilitiesFor(fam))
        if (c.level === "UNSUPPORTED") expect(c.verifiable, `${fam} ${c.id}`).toBe(false);
    }
  });

  it("automatic capabilities are always verifiable", () => {
    for (const c of capabilitiesFor("chrome")) if (c.level === "AUTOMATIC") expect(c.verifiable).toBe(true);
  });

  it("other Chromium browsers inherit Chrome's levels but nothing counts as validated", () => {
    const brave = capabilitiesFor("brave");
    expect(brave.map((c) => c.level)).toEqual(capabilitiesFor("chrome").map((c) => c.level));
    expect(brave.some((c) => c.validated)).toBe(false);
  });

  it("is what docs/BROWSER-CAPABILITIES.md shows", () => {
    const doc = readFileSync(
      fileURLToPath(new URL("../../../docs/BROWSER-CAPABILITIES.md", import.meta.url)),
      "utf8",
    );
    const between = doc.split("<!-- matrix:start -->")[1]?.split("<!-- matrix:end -->")[0]?.trim();
    expect(between, "Run: node scripts/sync-capability-doc.ts").toBe(renderMatrixMarkdown());
  });
});
