import { fileURLToPath } from "node:url";
import path from "node:path";
import type { InlineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = path.resolve(appDir, "../..");
const src = path.join(appDir, "src");

export const PAGES = ["popup", "onboarding", "options", "blocked"] as const;

type Common = { mode: string; define: Record<string, string>; watch: boolean };

/** Extension pages (popup, onboarding, options): regular Vite multi-page build. */
export function pagesConfig(outDir: string, c: Common): InlineConfig {
  return {
    configFile: false,
    root: src,
    mode: c.mode,
    base: "/",
    envDir: false,
    define: c.define,
    publicDir: path.join(appDir, "public"),
    plugins: [react(), tailwind()],
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: false,
      target: "es2022",
      sourcemap: c.mode !== "production",
      modulePreload: { polyfill: false },
      rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p, path.join(src, p, "index.html")])) },
      watch: c.watch ? {} : null,
    },
  };
}

/**
 * Background worker as one self-contained classic script: Chrome runs it as a service worker,
 * Firefox as a background script (Firefox MV3 has no service-worker background).
 */
export function backgroundConfig(outDir: string, c: Common): InlineConfig {
  return {
    configFile: false,
    root: src,
    mode: c.mode,
    envDir: false,
    define: c.define,
    publicDir: false,
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: false,
      target: "es2022",
      sourcemap: c.mode !== "production",
      lib: {
        entry: path.join(src, "background/index.ts"),
        formats: ["iife"],
        name: "eguardBackground",
        fileName: () => "background.js",
      },
      watch: c.watch ? {} : null,
    },
  };
}
