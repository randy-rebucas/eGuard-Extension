/**
 * Renders the eGuard mark into the toolbar/store icons (public/icons/icon-<size>.png).
 * Uses Playwright's Chromium so no image library is needed. Re-run after changing the mark:
 *   npm run icons -w @eguard/extension
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { appDir } from "./vite-configs.ts";

const SHIELD =
  "M32 4C24.4 8 16.4 10.2 8.5 11.2V30c0 14.6 9.8 25.4 23.5 30 13.7-4.6 23.5-15.4 23.5-30V11.2C47.6 10.2 39.6 8 32 4Z";
const inset = (s: number) => `translate(32 32) scale(${s}) translate(-32 -32)`;
// Same drawing as src/ui/components.tsx LogoMark. At 16px the inner cube is dropped so the shield stays crisp.
const svg = (size: number) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="2 2 60 60">
  <defs>
    <linearGradient id="o" x1="10" y1="6" x2="54" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#4FD2FF"/><stop offset=".55" stop-color="#2394F5"/><stop offset="1" stop-color="#1560DB"/>
    </linearGradient>
    <linearGradient id="i" x1="18" y1="16" x2="46" y2="50" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#8BE0FF"/><stop offset="1" stop-color="#2B8EF2"/>
    </linearGradient>
  </defs>
  <path d="${SHIELD}" fill="url(#o)"/>
  <path d="${SHIELD}" fill="#fff" transform="${inset(0.76)}"/>
  <path d="${SHIELD}" fill="url(#i)" transform="${inset(0.6)}"/>
  ${
    size >= 32
      ? `<g stroke-linejoin="round" stroke-width="1.2">
    <path d="M32 22.5 40.2 27.2 32 31.9 23.8 27.2Z" fill="#C4F0FF" stroke="#C4F0FF"/>
    <path d="M23.8 27.2 32 31.9V41.3L23.8 36.6Z" fill="#1E9BF2" stroke="#1E9BF2"/>
    <path d="M40.2 27.2 32 31.9V41.3L40.2 36.6Z" fill="#0B5FD4" stroke="#0B5FD4"/>
  </g>`
      : ""
  }
</svg>`;

const out = path.join(appDir, "public/icons");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`);
  await page.locator("svg").screenshot({ path: path.join(out, `icon-${size}.png`), omitBackground: true });
}
await browser.close();
console.log(`Icons written to ${out}`);
