import { z } from "zod";

export const BrowserFamily = z.enum(["chrome", "edge", "firefox", "safari", "brave", "opera", "chromium"]);
export type BrowserFamily = z.infer<typeof BrowserFamily>;

/** The build targets we ship manifests for. Other Chromium browsers run the chrome build. */
export const BuildTarget = z.enum(["chrome", "edge", "firefox"]);
export type BuildTarget = z.infer<typeof BuildTarget>;

export const BrowserInfo = z.object({
  family: BrowserFamily,
  name: z.string(),
  version: z.string().nullable(),
  /** Major version, when known. */
  major: z.number().int().nullable(),
});
export type BrowserInfo = z.infer<typeof BrowserInfo>;
